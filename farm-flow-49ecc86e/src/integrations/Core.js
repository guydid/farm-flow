const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export async function UploadFile({ file }) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
  return res.json();
}

export async function UploadPrivateFile({ file }) {
  return UploadFile({ file });
}

export async function CreateFileSignedUrl({ file_path }) {
  return { url: file_path };
}

export async function InvokeLLM() {
  return { content: '' };
}

export async function SendEmail() {
  return { success: true };
}

export async function SendSMS() {
  return { success: true };
}

export async function GenerateImage() {
  return { url: '' };
}

export async function ExtractDataFromUploadedFile() {
  return {};
}
