---
"@uxfactory/cli": minor
---

flow-story-coverage: the journey must realize its bound stories. The flow
input (`design/user-flow.json`) gains optional `storyRefs`; when a user-flow
unit declares them, a new must-check verifies every visible cover for each
bound story sits on a page inside the declared step order — coverage outside
the journey, an uncovered bound story, or a ref naming no registered story
all fail loudly. Skip-and-declare when the flow binds no stories; not-owed
off the user-flow unit. Turns "the states exist somewhere" into "the journey
is intact."
