// AI review is now initiated by request ID through the server-state adapter.
// The server computes evidence and stores the response atomically.
export async function requestReview(requestId,serverStore){return serverStore.review(requestId)}
