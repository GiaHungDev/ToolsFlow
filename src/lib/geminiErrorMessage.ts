/** Convert SDK errors (including JSON inside Error.message) to user-facing text. */
export function getGeminiErrorMessage(error: unknown): string {
  const details: Record<string, unknown>[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth++) {
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
      } catch {
        details.push({ message: current });
        break;
      }
    } else if (current && typeof current === "object") {
      const entry = current as Record<string, unknown>;
      details.push(entry);
      current = entry.error ?? entry.message;
    } else {
      break;
    }
  }

  const hasCode = (code: number, status: string) => details.some((entry) =>
    Number(entry.code) === code || Number(entry.status) === code || entry.status === status,
  );
  const message = details.map((entry) => typeof entry.message === "string" ? entry.message : "").join(" ");

  if (hasCode(503, "UNAVAILABLE") || /high demand|overloaded/i.test(message)) {
    return "Model AI đang quá tải. Vui lòng chờ một lát rồi thử lại, hoặc chọn model khác trong mục Model AI.";
  }
  if (hasCode(429, "RESOURCE_EXHAUSTED")) {
    return "Đã đạt giới hạn sử dụng Gemini. Vui lòng thử lại sau hoặc kiểm tra hạn mức của API Key.";
  }
  if (hasCode(401, "UNAUTHENTICATED") || /API_KEY_INVALID|API key not valid/i.test(message)) {
    return "API Key Gemini không hợp lệ hoặc đã hết hiệu lực. Vui lòng kiểm tra và cập nhật API Key.";
  }
  if (hasCode(403, "PERMISSION_DENIED")) {
    return "API Key chưa có quyền sử dụng model này. Vui lòng kiểm tra quyền truy cập hoặc chọn model khác.";
  }
  if (hasCode(404, "NOT_FOUND")) {
    return "Model AI hiện không khả dụng với yêu cầu này. Vui lòng chọn model khác trong mục Model AI.";
  }
  if (hasCode(504, "DEADLINE_EXCEEDED") || /timeout|timed out/i.test(message)) {
    return "Model AI phản hồi quá lâu. Vui lòng thử lại sau hoặc chọn model khác.";
  }
  if (/failed to fetch|fetch failed|network error|networkerror|load failed/i.test(message)) {
    return "Không thể kết nối đến Gemini. Vui lòng kiểm tra kết nối mạng rồi thử lại.";
  }
  if (error instanceof SyntaxError || /Invalid AI response/i.test(message)) {
    return "AI trả về nội dung chưa hợp lệ. Vui lòng tạo lại hoặc chọn model khác.";
  }
  if (hasCode(400, "INVALID_ARGUMENT")) {
    return "Gemini chưa thể xử lý yêu cầu này. Vui lòng kiểm tra nội dung, ảnh đầu vào hoặc chọn model khác.";
  }
  return "Chưa thể tạo nội dung bằng AI lúc này. Vui lòng thử lại sau hoặc chọn model khác.";
}
