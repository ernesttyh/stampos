#!/bin/sh
# Run ONLY against the disposable local database bootstrapped with messaging-bootstrap.sql:
# runuser -u postgres -- sh tests/messaging-concurrency.sh stampos_messaging_test
set -eu
db=${1:-}
[ "$db" = stampos_messaging_test ] || { echo 'Refusing non-test database' >&2; exit 1; }
export PGHOST=/var/run/postgresql PGPORT=5432
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
tmp=$(mktemp -d)
sql() { psql -X -v ON_ERROR_STOP=1 -At -d "$db" -c "$1"; }
b=$(sql "insert into brands(slug,name) values('message-race-'||gen_random_uuid(),'Race test') returning id")
b=$(printf '%s\n' "$b" | head -1)
cleanup() { sql "delete from brands where id='$b'" >/dev/null; rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM
c=$(sql "insert into customers(brand_id,phone,name,marketing_consent,telegram_chat_id) values('$b','+6598765432','Race',true,123) returning id" | head -1)
cp=$(sql "insert into campaigns(brand_id,title,body,bonus_stamps) values('$b','Race','No network sends',2) returning id" | head -1)

# Concurrent starts must snapshot once, atomically.
i=0
while [ "$i" -lt 8 ]; do
  sql "select messaging_start_campaign('$cp')" >"$tmp/start-$i" &
  i=$((i+1))
done
wait
[ "$(sql "select count(*) from messaging_campaign_recipients where campaign_id='$cp'")" = 1 ]
sql "update messaging_campaign_recipients set status='uncertain' where campaign_id='$cp'" >/dev/null

# All callers deliberately use DIFFERENT operation keys: canonical campaign key wins.
i=0
while [ "$i" -lt 12 ]; do
  sql "select messaging_claim('$c','$b','different-$i','campaign','$cp',false,0,2,'Race')" >"$tmp/claim-$i" &
  i=$((i+1))
done
wait
[ "$(sql "select lifetime_stamps from customers where id='$c'")" = 2 ]
[ "$(sql "select count(*) from stamps where customer_id='$c'")" = 1 ]
[ "$(sql "select count(*) from messaging_claims where campaign_id='$cp'")" = 1 ]

# Different automatic trigger loops race: one shared SG-day claim, one bonus.
i=0
while [ "$i" -lt 12 ]; do
  sql "select messaging_claim('$c','$b','auto-$i','trigger-$i',null,true,0,1,'Auto race')" >"$tmp/auto-$i" &
  i=$((i+1))
done
wait
[ "$(sql "select count(*) from messaging_claims where customer_id='$c' and automatic")" = 1 ]
[ "$(sql "select lifetime_stamps from customers where id='$c'")" = 3 ]

# Parallel queue workers return disjoint IDs, bounded batches, complete audience.
sql "insert into customers(brand_id,phone,name) select '$b','+6577'||lpad(i::text,6,'0'),'Queue '||i from generate_series(1,100) i" >/dev/null
i=0
while [ "$i" -lt 5 ]; do
  sql "select messaging_auto_batch('$b',25)" >"$tmp/queue-$i" &
  i=$((i+1))
done
wait
[ "$(sort "$tmp"/queue-* | wc -l | tr -d ' ')" = 101 ]
[ "$(sort "$tmp"/queue-* | uniq | wc -l | tr -d ' ')" = 101 ]
for f in "$tmp"/queue-*; do [ "$(wc -l <"$f")" -le 25 ]; done

# Annual entitlement race, including a customer who cannot receive marketing.
sql "update customers set birthday=(now() at time zone 'Asia/Singapore')::date,marketing_consent=false where id='$c'" >/dev/null
i=0
while [ "$i" -lt 8 ]; do
  sql "select messaging_issue_birthdays('$b')" >"$tmp/birthday-$i" &
  i=$((i+1))
done
wait
[ "$(sql "select count(*) from rewards where customer_id='$c' and type='birthday'")" = 1 ]
echo 'Messaging concurrency: campaign snapshot, unique credits, cross-trigger daily guard, disjoint queue and birthdays PASS'
