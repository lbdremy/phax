# Keep I/O in the module's caller

A module under `src/` computes; it does not read files, open sockets or spawn
processes. When a finding says a module imports a `node:` module:

1. Move the I/O (the `node:fs` read, the `node:child_process` call, …) to the
   caller, such as `src/cli.ts`.
2. Have the caller pass the values it read into the module's function as
   arguments.
3. Remove the `node:` import from the module, and keep its function pure: the
   same arguments give the same result.
