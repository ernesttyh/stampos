-- LOCAL disposable database only, after CREATE DATABASE stampos_messaging_test.
\set ON_ERROR_STOP on
\ir database_bootstrap.sql
\ir ../supabase/migrations/0004_auth_safety.sql
\ir ../supabase/migrations/0005_messaging_safety.sql
