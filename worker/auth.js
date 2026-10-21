// Moderator check shared by photos and the vote: Authorization: Bearer <MOD_TOKEN>, a secret set on the Worker.
export function isModerator(request, env) {
  const token = env.MOD_TOKEN;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !given || token.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
