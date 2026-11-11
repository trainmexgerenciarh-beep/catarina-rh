import type pg from "pg";
/** Inspect our TLS socket. A pooled endpoint can terminate TLS before PostgreSQL,
 * so pg_stat_ssl alone does not describe the application's verified connection. */
export function neonTlsVerified(client:unknown):boolean{
  const stream=(client as {connection?:{stream?:{encrypted?:boolean;authorized?:boolean}}})?.connection?.stream;
  return stream?.encrypted===true&&stream.authorized===true;
}
/** Explicit verify-full removes ambiguous pg sslmode aliases without changing
 * Secrets. Never return/log a connection string in an API or health response.
 */
export function neonPoolOptions(raw=process.env.DATABASE_URL):pg.PoolConfig{
  if(!raw)throw new Error("DATABASE_CONFIGURATION_REQUIRED");
  const url=new URL(raw);
  url.searchParams.set("sslmode","verify-full");
  return {connectionString:url.toString(),ssl:{rejectUnauthorized:true},
    connectionTimeoutMillis:10000,max:4,allowExitOnIdle:true};
}
