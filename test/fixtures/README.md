# Test fixtures

Frozen copies of the models the automated suites assert against.

They live here, and **not** in `examples/`, because `examples/` is working
material: it is edited in the app, re-saved, renamed and deleted. On 2026-07-31
that broke the suite — `datacentre-ring.pnet.json` was re-saved from the app
with different geometry (45 → 60 pipes) and the two
`data_centre_redundant_ring_main` files were deleted, so `simulation.test.js`
crashed on a missing file and `closed`/`supply` failed on numbers that no longer
described the model in front of them.

A regression baseline has to be immutable or it is not a baseline. Change these
only when you mean to change what is being asserted, and regenerate the expected
values in the same commit.
