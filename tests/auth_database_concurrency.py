"""LOCAL ONLY. Run after bootstrap + 0004 in the dedicated stampos_auth_test DB.

  runuser -u postgres -- createdb stampos_auth_test
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d stampos_auth_test -f tests/database_bootstrap.sql
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d stampos_auth_test -f supabase/migrations/0004_auth_safety.sql
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d stampos_auth_test -f tests/auth_database_regression.sql
  python3 tests/auth_database_concurrency.py

No live URL accepted. Never stops PostgreSQL or drops the database. Uses 20 local connections.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent.parent
PSQL = (["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []) + [
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", "stampos_auth_test",
]


def sql(statement):
    result = subprocess.run(PSQL, input=statement, text=True, capture_output=True, check=True)
    return [line for line in result.stdout.strip().splitlines() if line]


def race(statement_for):
    def call(i):
        # Independent sessions overlap while locks remain held until commit.
        return sql("begin; " + statement_for(i) + "; select pg_sleep(0.08); commit;")[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        return list(pool.map(call, range(20)))


b, c = str(uuid.uuid4()), str(uuid.uuid4())
key = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
token_hash = None
try:
    sql(f"""
      insert into brands(id,slug,name) values('{b}','auth-race-{b}','Auth Race');
      insert into customers(id,brand_id,name,phone) values('{c}','{b}','Auth Race','+6591234567');
    """)
    results = race(lambda _: f"select consume_auth_attempt('{key}',5,900)::text")
    assert results.count("true") == 5 and results.count("false") == 15, results
    assert sql(f"select attempts from auth_attempts where key_hash='{key}'") == ["20"]
    print("PASS: 20 concurrent throttle requests -> exactly 5 allowed / 15 denied, durable count 20")

    # Call actual TypeScript crypto helper; no reimplementation or source-only assertion.
    env = dict(os.environ, SESSION_SECRET="79207cb11eab085f74316cbea42d0a5f9268b3c475f9c820d")
    js = """
      import {newTelegramToken,telegramTokenHash} from './src/lib/auth-safety.ts';
      import {createHmac} from 'node:crypto';
      const token=newTelegramToken();
      const nonce=token.slice(0,22);
      const wrongPurpose=nonce+createHmac('sha256',process.env.SESSION_SECRET).update('phone-proof:v1:'+nonce).digest().subarray(0,16).toString('base64url');
      const tamper=(token[0]==='A'?'B':'A')+token.slice(1);
      console.log(JSON.stringify({hash:telegramTokenHash(token),wrongPurpose:telegramTokenHash(wrongPurpose),tamper:telegramTokenHash(tamper),rawId:telegramTokenHash(process.env.TEST_CUSTOMER_ID)}));
    """
    env["TEST_CUSTOMER_ID"] = c
    crypto = json.loads(subprocess.run(["bun", "-e", js], cwd=ROOT, env=env, check=True, capture_output=True, text=True).stdout)
    token_hash = crypto["hash"]
    assert token_hash and crypto["wrongPurpose"] is None and crypto["tamper"] is None and crypto["rawId"] is None, crypto
    sql(f"insert into telegram_link_tokens values('{token_hash}','{c}',clock_timestamp()+interval '10 minutes')")
    for invalid in [crypto["wrongPurpose"], crypto["tamper"], crypto["rawId"]]:
        # Handler refuses null helper results before RPC; SQL also cannot consume these.
        assert invalid is None
        assert sql("select coalesce(consume_telegram_link(null,987654)::text,'REJECTED')") == ["REJECTED"]
    print("PASS: actual TypeScript signature helper rejects wrong purpose, modified payload and raw customer ID; no DB consumption")

    results = race(lambda i: f"select coalesce(consume_telegram_link('{token_hash}',{700000+i})::text,'REJECTED')")
    assert results.count(c) == 1 and results.count("REJECTED") == 19, results
    winner = results.index(c)
    assert sql(f"select telegram_chat_id from customers where id='{c}'") == [str(700000+winner)]
    assert sql(f"select count(*) from telegram_link_tokens where token_hash='{token_hash}'") == ["0"]
    assert sql(f"select coalesce(consume_telegram_link('{token_hash}',999999)::text,'REJECTED')") == ["REJECTED"]
    print("PASS: 20 concurrent signed-token links -> exactly one winner, committed chat matches winner, replay rejected")

    # Permission denial is executed, not just introspected.
    for role, statement in [("anon", f"select consume_auth_attempt('{key}',5,900)"), ("authenticated", f"select consume_telegram_link('{token_hash}',999999)")]:
        result = subprocess.run(PSQL, input=f"set role {role}; {statement};", capture_output=True, text=True)
        assert result.returncode != 0 and "permission denied" in result.stderr, result
    print("PASS: real anon/authenticated role calls denied by PostgreSQL")
finally:
    sql(f"delete from auth_attempts where key_hash='{key}'; delete from brands where id='{b}';")
