// Moderator check shared by photos, parents' reports and site feedback: Authorization: Bearer <MOD_TOKEN>, a secret set on the Worker.
export function isModerator(request, env) {
  // Trimmed on both sides: a key pasted with a stray space or newline would otherwise never match.
  const token = (env.MOD_TOKEN || '').trim();
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !given || token.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
