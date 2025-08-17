// Interface
export interface IBase {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUser extends IBase {
  username: string;
  password: string;
  email: string;
  role: number;
  keycloakId: string;
}
