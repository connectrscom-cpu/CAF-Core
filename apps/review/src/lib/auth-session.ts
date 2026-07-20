/** Review session cookie for CAF account auth. */
export const CAF_SESSION_COOKIE = "caf_session";

export function sessionCookieOptions(maxAgeSeconds = 30 * 24 * 60 * 60) {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
