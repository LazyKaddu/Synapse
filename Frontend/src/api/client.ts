import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor: attach JWT
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = useAuthStore.getState().accessToken;
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: handle 401 and token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const refreshed = await this.refreshToken();
            if (refreshed) {
              const token = useAuthStore.getState().accessToken;
              if (originalRequest.headers && token) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              return this.client(originalRequest);
            }
          } catch {
            useAuthStore.getState().logout();
            window.location.href = '/login';
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async refreshToken(): Promise<boolean> {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true }
      );
      const { accessToken } = response.data;
      useAuthStore.getState().setAccessToken(accessToken);
      return true;
    } catch {
      return false;
    }
  }

  // Auth endpoints
  async login(email: string, password: string) {
    const response = await this.client.post('/auth/login', { email, password });
    return response.data;
  }

  async register(email: string, password: string, username: string) {
    const response = await this.client.post('/auth/register', { email, password, username });
    return response.data;
  }

  async logout() {
    await this.client.post('/auth/logout');
  }

  async getCharacters() {
    const response = await this.client.get('/characters');
    return response.data;
  }

  async createCharacter(name: string, classId: number) {
    const response = await this.client.post('/characters', { name, classId });
    return response.data;
  }

  async selectCharacter(characterId: string) {
    const response = await this.client.post('/characters/select', { characterId });
    return response.data;
  }

  // Generic methods
  get<T>(url: string, params?: object) {
    return this.client.get<T>(url, { params });
  }

  post<T>(url: string, data?: object) {
    return this.client.post<T>(url, data);
  }

  put<T>(url: string, data?: object) {
    return this.client.put<T>(url, data);
  }

  delete<T>(url: string) {
    return this.client.delete<T>(url);
  }
}

export const apiClient = new ApiClient();
export default apiClient;