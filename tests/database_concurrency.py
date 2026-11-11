"""Local PostgreSQL regression, no network services or dependencies.

After database_bootstrap.sql:
  python3 tests/database_concurrency.py
DATABASE_URL defaults to postgresql:///stampos_test_db. Root uses local postgres OS user.
Each test races 12 independent connections, and verifies committed ledger state.
"""
import concurrent.futures
import json
import os
import subprocess
import uuid

URL = os.environ.get("DATABASE_URL", "postgresql:///stampos_test_db")
PSQL = (["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []) + [
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", URL,
]


def sql(statement, fail_ok=False):
    result = subprocess.run(PSQL, input=statement, text=True, capture_output=True)
    if result.returncode and not fail_ok:
        raise AssertionError(result.stderr)
    return result


def value(statement):
    return sql(statement).stdout.strip().splitlines()[-1]


def race(statement, expected_successes=None):
    def invoke(_):
        # Hold the winner's locks briefly so competing sessions overlap deterministically.
        return sql("begin; " + statement + "; select pg_sleep(0.15); commit;", fail_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(invoke, range(12)))
    successes = sum(r.returncode == 0 for r in results)
    if expected_successes is not None:
        assert successes == expected_successes, [r.stderr for r in results]
    return results


b, outlet, worker, actor, customer, referrer, grant, request = [str(uuid.uuid4()) for _ in range(8)]
try:
    sql(f"""
      begin;
      insert into brands(id,slug,name,migration_until) values('{b}','chengdu-bowl','Race',current_date+7);
      insert into outlets(id,brand_id,name) values('{outlet}','{b}','Outlet');
      insert into staff(id,brand_id,outlet_id,name,pin_hash) values('{worker}','{b}','{outlet}','Worker','unused');
      insert into auth.users(id,email) values('{actor}','race-{actor}@test.invalid');
      insert into brand_members(user_id,brand_id,role) values('{actor}','{b}','manager');
      insert into customers(id,brand_id,phone,name) values('{referrer}','{b}','+6591111110','Friend');
      insert into customers(id,brand_id,phone,name,referred_by,last_visit_at)
        values('{customer}','{b}','+6591111111','Original','{referrer}',now()-interval '7 days');
      insert into influencer_grants(id,brand_id,handle,rewards_total,rewards_upfront)
        values('{grant}','{b}','@race',4,1);
      commit;
    """)
    race(f"select admin_credit_creator('{b}','+6591111111','Preserve Original','@race','instagram','{actor}','{request}')", 12)
    assert value(f"select count(*) from rewards where customer_id='{customer}'") == "4"
    assert value(f"select count(*) from creator_benefits where brand_id='{b}'") == "1"
    assert value(f"select count(*) from events where brand_id='{b}' and type='creator_four_bowls_credited'") == "1"
    assert value(f"select name||':'||marketing_consent::text from customers where id='{customer}'") == "Original:false"
    print("PASS: 12 creator retries -> one allocation / exactly four available rewards")

    race(f"select staff_issue_stamps('{customer}',2,'{outlet}','{worker}','staff')", 1)
    assert value(f"select lifetime_stamps from customers where id='{customer}'") == "4"
    assert value(f"select count(*) from stamps where customer_id='{customer}' and source='streak'") == "1"
    assert value(f"select lifetime_stamps from customers where id='{referrer}'") == "1"
    print("PASS: 12 staff stamps -> one base stamp, one streak, one referral pair")

    race(f"select staff_issue_stamps('{customer}',9,'{outlet}','{worker}','migration')", 1)
    assert value(f"select count(*) from stamps where customer_id='{customer}' and source='migration'") == "1"
    print("PASS: 12 migration attempts -> one credit")

    race(f"select claim_customer_bonus('{customer}','install')", 12)
    assert value(f"select count(*) from stamps where customer_id='{customer}' and source='install'") == "1"
    race(f"select claim_customer_bonus('{customer}','spin')", 12)
    assert value(f"select count(*) from events where customer_id='{customer}' and type='spin'") == "1"
    print("PASS: install and spin claims each consumed exactly once")

    race(f"select accept_creator_grant('{grant}','{customer}')", 12)
    assert value(f"select count(*) from rewards where grant_id='{grant}'") == "4"
    race(f"select manage_creator_grant('{grant}','{b}','{actor}','verify')", 12)
    assert value(f"select count(*) from rewards where grant_id='{grant}' and status='available'") == "4"
    assert value(f"select count(*) from events where brand_id='{b}' and type='creator_grant_verify'") == "1"
    print("PASS: invite acceptance and verification cannot duplicate rewards/events")

    request = str(uuid.uuid4())
    race(f"select admin_adjust_customer('{b}','{customer}','{actor}','{request}','reward',2,'Gift',30)", 12)
    assert value(f"select count(*) from rewards where customer_id='{customer}' and type='manual'") == "2"
    request = str(uuid.uuid4())
    race(f"select admin_adjust_customer('{b}','{customer}','{actor}','{request}','stamps',2,null,null)", 12)
    assert value(f"select count(*) from stamps where customer_id='{customer}' and source='admin'") == "1"
    print("PASS: manual stamp and reward retries each credit exactly once")

    code = value(f"select code from rewards where grant_id='{grant}' limit 1")
    results = race(f"select redeem_reward('{code}','{outlet}','{worker}')", 12)
    # SQL returns structured errors for consumed rewards; only one result can have ok=true.
    ok = 0
    for result in results:
        for line in result.stdout.splitlines():
            if line.startswith("{"):
                ok += bool(json.loads(line).get("ok"))
    assert ok == 1
    print("PASS: 12 redemption attempts -> exactly one successful redemption")
finally:
    sql(f"delete from brands where id='{b}'; delete from auth.users where id='{actor}';")
