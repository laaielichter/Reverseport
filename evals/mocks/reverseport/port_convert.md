---
expect:
  from: string
  to: string
---

{"from": "Godot (right-handed, Y up, -Z forward, m)", "to": "Unreal (left-handed, Z up, X forward, Y right, cm)", "axisMatrix": [[0, 0, -1], [1, 0, 0], [0, 1, 0]], "unitFactor": 100, "position": [-300, 100, 200], "notes": ["Positions and rotations stay visually identical; the axis matrix shows where each source axis goes.", "Handedness changes (mirror): meshes imported separately keep their own importer orientation \u2014 if a model looks backwards, rotate that node 180\u00b0 about the up axis.", "Distances scale \u00d7100 (speeds, forces and ranges in code too)."]}
