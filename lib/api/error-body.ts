export type PublicErrorBody = {
  error: {
    title: string;
    message: string;
    stage?: string;
  };
};
