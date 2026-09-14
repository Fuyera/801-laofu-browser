export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public retryable = false,
  ) {
    super(message);
    this.name = "Fault";
  }
}
export const fail = (code: string, message: string, status = 400): never => {
  throw new Fault(code, message, status);
};
export function problem(e: unknown) {
  return e instanceof Fault
    ? { code: e.code, message: e.message, retryable: e.retryable }
    : {
        code: "INTERNAL",
        message: "执行失败；详细原因仅在本机诊断中可见",
        retryable: false,
      };
}
