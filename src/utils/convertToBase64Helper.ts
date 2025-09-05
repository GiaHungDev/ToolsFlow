// Helper function để chuyển đổi File sang base64
export const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      // reader.result sẽ là data URL dạng: "data:image/jpeg;base64,..."
      const result = reader.result as string;
      resolve(result);
    };

    reader.onerror = () => {
      reject(new Error("Lỗi khi đọc file"));
    };

    reader.readAsDataURL(file);
  });
};

// Helper function để chuyển đổi nhiều files sang base64
export const convertFilesToBase64 = async (
  files: File[]
): Promise<string[]> => {
  const promises = files.map((file) => convertFileToBase64(file));
  return Promise.all(promises);
};

// Helper function để lấy chỉ base64 string (bỏ phần data:image/...;base64,)
export const getBase64StringOnly = (dataUrl: string): string => {
  const base64Index = dataUrl.indexOf(",");
  return base64Index !== -1 ? dataUrl.substring(base64Index + 1) : dataUrl;
};

// Helper function chuyển đổi và chỉ lấy base64 string
export const convertFileToBase64String = async (
  file: File
): Promise<string> => {
  const dataUrl = await convertFileToBase64(file);
  return getBase64StringOnly(dataUrl);
};
