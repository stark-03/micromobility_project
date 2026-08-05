# ADR 0002 — `allowPublicKeyRetrieval` is not a mysql2 option

**Status:** accepted
**Date:** 2026-08-05
**Supersedes guidance in:** `CLAUDE.md` §"Version notes that actually affect the code",
`docs/design.md` §10

## Context

`CLAUDE.md` instructs:

> Over a plain localhost socket, `mysql2` needs the server's public key for the initial
> password exchange. Set `dialectOptions: { allowPublicKeyRetrieval: true }` in the Sequelize
> config for local development only.

We set it. On the first real connection mysql2 emitted:

```
Ignoring invalid configuration option passed to Connection: allowPublicKeyRetrieval.
This is currently a warning, but in future versions of MySQL2, an error will be thrown
if you pass an invalid configuration option to a Connection
```

`allowPublicKeyRetrieval` is a **JDBC** connection property, from the MySQL Connector/J driver.
The Node `mysql2` driver has no option of that name.

## Decision

Remove it from `dialectOptions`.

## Consequences

- **Nothing breaks.** mysql2 implements `caching_sha2_password` natively, including requesting
  the server's RSA public key itself when the server-side auth cache is cold and the connection
  is not TLS-protected. The API authenticates against MySQL 8.4.10 as a
  `caching_sha2_password` user with no extra configuration. Verified by the full integration
  suite connecting successfully.
- **A future mysql2 release would have thrown on startup** had we kept it, turning a cosmetic
  warning into an outage at exactly the wrong moment.
- **The surrounding advice in `CLAUDE.md` remains correct and important:** MySQL 8.4 removed
  `mysql_native_password`, so Sequelize must use the `mysql2` driver. The legacy `mysql`
  package cannot complete the `caching_sha2_password` handshake — that is what
  `ER_NOT_SUPPORTED_AUTH_MODE` means, and the fix is never to recreate the user with
  `mysql_native_password`, because the plugin no longer exists in 8.4.

## Note for remote deployments

The original instruction carried a warning not to enable public-key retrieval against a remote
server, and to use TLS there instead. That guidance still holds as a *deployment* rule even
though the specific option does not exist: when this project stops talking to `localhost`, the
connection must use TLS (`dialectOptions: { ssl: { ... } }`), so the password exchange is never
exposed on the wire regardless of how the driver negotiates it.
