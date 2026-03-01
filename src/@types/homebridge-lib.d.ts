declare module 'homebridge-lib/EveHomeKitTypes' {
  export class EveHomeKitTypes {
    constructor(homebridge: unknown);

    Characteristics: Record<string, unknown>;
    Services: Record<string, unknown>;
  }
}

declare module 'homebridge-lib' {
}