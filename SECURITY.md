# Security

Gongzuo is an early, single-user local application. It binds to loopback and has no multi-user authentication. Do not expose it directly to the internet.

API keys are stored unencrypted in `.local-data/config.json`. Task files and exports can contain sensitive user content. These are excluded from source control by default.

To report a security issue, use the repository's **Security → Report a vulnerability** feature. Include a minimal reproducer using fake keys and invented data. Do not put credentials or personal task exports in a public issue.

The maintained release line is currently 0.2.x. There is no guarantee of production-grade hardening or a fixed response time.
