/** Pure decision for the manager pattern gate.
 *  Extracted so a unit test can pin "fail closed" without mounting React.
 *  503 (server has no secret configured) must NOT fall back to a client copy. */
export function patternVerdict(status, ok) {
  return status === 200 && ok === true;
}
