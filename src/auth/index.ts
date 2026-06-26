export type Persona = "talent" | "company_admin";

export interface AuthProvider {
  getIdToken(persona: Persona): Promise<string>;
}

export class MockAuthProvider implements AuthProvider {
  async getIdToken(persona: Persona): Promise<string> {
    return `mock-token-for-${persona}`;
  }
}

// TODO: FirebaseAuthProvider