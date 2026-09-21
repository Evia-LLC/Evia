# MediaPipe canonical face — development fixture

`face-data.json` is a transformed, generic MediaPipe reference model used only by
`studio-fixture.ts` in the explicitly labelled development studio. It is not a
person's capture, a detector result, or a skincare measurement. Production scans
continue to use `src/scan/face-mesh.ts`; they do not import this fixture.

The MediaPipe Authors provide the source under **Apache License 2.0**. The
repository's license is reproduced verbatim in [MEDIAPIPE-LICENSE.txt](./MEDIAPIPE-LICENSE.txt).
The connection definitions carry `Copyright 2023 The MediaPipe Authors.`

Sources verified and retrieved on 2026-09-17, pinned to repository revision
`2bce9dd15fa45f267c9e5f77086997c984a9f107`:

- [canonical_face_model.obj](https://github.com/google-ai-edge/mediapipe/blob/2bce9dd15fa45f267c9e5f77086997c984a9f107/mediapipe/modules/face_geometry/data/canonical_face_model.obj): the original 468 face vertices, in canonical landmark order.
- [face_model_with_iris.obj](https://github.com/google-ai-edge/mediapipe/blob/2bce9dd15fa45f267c9e5f77086997c984a9f107/mediapipe/modules/face_geometry/data/face_model_with_iris.obj): ten additional official iris vertices, indices 468–477. Its first 468 vertex coordinates were checked against the canonical model and are exactly identical.
- [face_landmarks_connections.ts](https://github.com/google-ai-edge/mediapipe/blob/2bce9dd15fa45f267c9e5f77086997c984a9f107/mediapipe/tasks/web/vision/face_landmarker/face_landmarks_connections.ts): official tessellation, contours and face oval.
- [Repository license](https://github.com/google-ai-edge/mediapipe/blob/2bce9dd15fa45f267c9e5f77086997c984a9f107/LICENSE).
- [Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker): the current detector outputs 478 three-dimensional landmarks.

## Modifications and coordinate mapping

Only vertex coordinates were translated, uniformly scaled and converted to the
`ScanMesh` axes. Landmark order and all connection indices are unchanged. No
landmarks, face detail, eyeball surfaces or region anchors were invented.

The model's bounds are X `[-7.743095, 7.743095]`, Y `[-9.403378, 8.261778]`,
Z `[-2.435867, 7.586580]`. Their midpoint is `(0, -0.5708, 2.5753565)`.
To fit a square source image with a face height of 0.8 image units, use
`s = 0.8 / 17.665156`, then transform every canonical vertex `(X, Y, Z)`:

```text
x = 0.5 + X * s
 y = 0.5 - (Y + 0.5708) * s
 z = -(Z - 2.5753565) * s
aspect = 1
```

Coordinates are rounded to eight decimal places. Thus x is in normalized image
units, y points downward, and forward depth is negative. The renderer's own
centering and face-height normalization recover the original proportions.

`points` contains 478 vertices (1,434 numbers). `edges` preserves all 2,556
FaceLandmarker tessellation segments, including repeated triangle edges, exactly
as the production capture path supplies them. These represent 1,322 unique
undirected edges. `contours` contains 124 segments in the official ordering;
`oval` contains 36. Tessellation and contours use the first 468 face vertices;
the ten iris points remain separate points, matching the standard detector
connection sets. There are no dense eyeball shells or iris fan triangles.

The old custom `regionAnchors` are removed so the renderer uses its existing
canonical `REGION_SPOTS` indices. Both the `/studio` entry point and
`studioFace()` require `import.meta.env.DEV`.

## Original source checksums (SHA-256)

```text
canonical_face_model.obj
8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618

face_model_with_iris.obj
cc5659c31aa4fa3412cb33629b0ebd6e16a75e79746daa07d1c44c61780cae5e

face_landmarks_connections.ts
edbb757a7cc48e640dbd60ca53a8c5ea6fe4b11b06b9a75fb67cbb0699394a23
```
