import { Cron, StackContext, Config } from "sst/constructs";

export function ExampleStack({ stack }: StackContext) {
  // Add your first construct
  const PK = new Config.Secret(stack, "PK");
  const tgToken = new Config.Secret(stack, "tgToken");
  const MAINNET_URL = new Config.Secret(stack, "MAINNET_URL");
  const FRAXTAL_URL = new Config.Secret(stack, "FRAXTAL_URL");
  const job = new Cron(stack, "cron", {
    schedule: "rate(5 minutes)",
    job: "packages/functions/src/lambda.main",
  });
  job.bind([PK, tgToken, MAINNET_URL, FRAXTAL_URL])
}
