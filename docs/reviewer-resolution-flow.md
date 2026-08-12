# Review Room reviewer-resolution flow

The Review Room roadmap now treats “Mark as resolved” as a reviewer assertion, not a claim that an agent implemented the requested change. Active issues can be resolved individually, with an atomic “Mark all as resolved” action when more than one remains. Resolved issue text stays visible in a collapsed history section.

“Add more feedback” remains available for empty, partially resolved, and fully resolved rooms. A new send describes its composition before submission—unresolved prior issues plus new drafts—and the backend freezes that exact set. Reviewer-resolved issues are excluded without changing or cloning the originals.

“Retry revision” is a secondary recovery action. It retries the prior immutable submission and its spatial evidence; current drafts are never attached. An unverifiable attempt uses the explicit copy “Couldn’t verify the previous revision” and explains that retry is appropriate only if the prior revisions were not applied. Resolution actions never leave the room trapped behind a stale retry card, and a fully resolved room presents a clean reviewed state.

The Dashboard consumes backend-produced contract fixtures so cross-round issue identities and reviewer provenance are checked against the actual packet producer rather than duplicated test data.
