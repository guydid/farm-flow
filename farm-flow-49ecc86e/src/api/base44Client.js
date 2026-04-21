// Local development replacement for Base44 SDK client
import { createEntity, localAuth } from './localClient';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export const base44 = {
  entities: new Proxy({}, {
    get(_, entityName) {
      return createEntity(entityName);
    }
  }),
  auth: { ...createEntity('users'), ...localAuth },
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: formData });
        return res.json();
      },
      UploadPrivateFile: async ({ file }) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: formData });
        return res.json();
      },
      CreateFileSignedUrl: async ({ file_path }) => ({ url: file_path }),
      InvokeLLM: async () => ({ content: '' }),
      SendEmail: async () => ({ success: true }),
      SendSMS: async () => ({ success: true }),
      GenerateImage: async () => ({ url: '' }),
      ExtractDataFromUploadedFile: async () => ({}),
    }
  },
  functions: {
    invoke: async (name, params) => {
      const res = await fetch(`${BASE_URL}/functions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      });
      return res.json();
    }
  },
  appLogs: {
    logUserInApp: async () => {}
  }
};
