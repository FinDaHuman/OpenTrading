# Local operations

Store application state under the user's application-data directory. The future SQLite session store
uses migrations, write-ahead logging, transactional event append, and a schema-version table. Startup
marks non-terminal runs from a previous process as `interrupted`; it never resumes remote work without
an explicit user action.

Provide commands to inspect, export, and delete local sessions before persistence is released. Exports
exclude credentials. Define retention by event class and allow users to remove remembered preferences.

Current CI builds and installs an unsigned wheel and source distribution. Signing and provenance are
a release requirement to implement before public distribution. Release notes state data API,
provider, database-schema, and configuration compatibility. Local logs default to minimal metadata,
rotate by size/time, and have a documented deletion path.

Operational metrics for a future runtime include run duration, first-token latency, tool latency,
tokens, estimated provider cost, retries, stale/partial results, cancellations, and evidence-validation
failures. Metrics never include secrets or full financial content.
