"""Verify historical mismatches abort the additive migration without rewriting data.

Local isolated stampos_test_db only; run after database_bootstrap.sql.
Each deliberately invalid fixture lives in a transaction that rolls back on disconnect.
"""
import os
from pathlib import Path
import subprocess
import uuid

url = os.environ.get("DATABASE_URL", "postgresql:///stampos_test_db")
command = (["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []) + [
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", url,
]
migration = (Path(__file__).resolve().parents[1] / "supabase/migrations/0003_launch_safety.sql").read_text()

for kind in ("reward", "grant"):
    b, other, customer, record = [str(uuid.uuid4()) for _ in range(4)]
    fixture = f"""
      begin;
      insert into brands(id,slug,name) values('{b}','preflight-{b}','Preflight'),('{other}','preflight-{other}','Other');
      insert into customers(id,brand_id,phone,name) values('{customer}','{b}','+6592222222','Test');
    """
    if kind == "reward":
        fixture += f"""
          alter table rewards disable trigger reward_relationship_guard;
          insert into rewards(id,brand_id,customer_id,type,title)
            values('{record}','{other}','{customer}','manual','Historical mismatch');
        """
    else:
        fixture += f"""
          alter table influencer_grants disable trigger grant_relationship_guard;
          insert into influencer_grants(id,brand_id,customer_id,handle)
            values('{record}','{other}','{customer}','@historical');
        """
    result = subprocess.run(command, input=fixture + migration + "\nrollback;", text=True, capture_output=True)
    assert result.returncode != 0, "Preflight unexpectedly allowed historical mismatch"
    assert "Launch safety aborted" in result.stderr and record in result.stderr, result.stderr
    print(f"PASS: historical {kind} mismatch aborts with actionable record ID, no data rewrite")
