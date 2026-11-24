// src/utils/patternPassword.js
//
// The manager pattern is SERVER-SIDE ONLY. This module used to carry a
// hard-coded default (and read a public build-time variable, which is inlined
// into the browser bundle). Both were removed on purpose:
//   - a NEXT_PUBLIC_* var is never a secret;
//   - a hard-coded pattern ships to every visitor.
//
// /api/auth/pattern is the only authority. When the server has no secret
// configured it answers 503 and the gate fails closed.
export const EXPECTED_PATTERN = [];
