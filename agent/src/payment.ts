import "dotenv/config";
import { formatUnits, type Address } from "viem";
import { agentPayAbi } from "./agentpay-abi.js";
import { agentPayAddress, publicClient } from "./chain.js";
import { validatePaymentInput } from "./payment-validation.js";
import { assertLeasePaymentAllowed } from "./lease-payment-guards.js";

/**
 * A validated payment intent. It is data for the connected delegate wallet
 * to review and sign; it is not a signed transaction and cannot move funds.
 */
export type PreparedPayment = {
  leaseId: string;
  delegate: Address;
  recipient: Address;
  amountUsdc: string;
  amountBaseUnits: string;
  remainingAllowanceUsdc: string;
  contract: Address;
  chainId: 5042;
  requiresDelegateWalletConfirmation: true;
};

export type PaymentRequest = {
  leaseId: bigint;
  delegate: Address;
  recipient: Address;
  amountUsdc: string;
};

export async function prepareLeasePayment(request: PaymentRequest): Promise<PreparedPayment> {
  const input = validatePaymentInput(request);

  // Verify the chain while the independent read-only preflight requests run.
  const [chainId, lease, allowance, latestBlock] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({
      address: agentPayAddress,
      abi: agentPayAbi,
      functionName: "leases",
      args: [input.leaseId]
    }),
    publicClient.readContract({
      address: agentPayAddress,
      abi: agentPayAbi,
      functionName: "remainingAllowance",
      args: [input.leaseId]
    }),
    publicClient.getBlock({ blockTag: "latest" })
  ]);
  if (chainId !== 5042) throw new Error(`Wrong network: expected Arc Mainnet 5042, received ${chainId}.`);
  const [owner, registeredDelegate, , , expiry, , , , balance, allowlistEnabled, revoked] = lease;

  let recipientAllowed = false;
  if (allowlistEnabled) {
    recipientAllowed = await publicClient.readContract({
      address: agentPayAddress,
      abi: agentPayAbi,
      functionName: "allowedRecipients",
      args: [input.leaseId, input.recipient]
    });
  }

  assertLeasePaymentAllowed({
    lease: {
      owner,
      delegate: registeredDelegate,
      expiry,
      revoked,
      balance,
      remainingAllowance: allowance,
      allowlistEnabled,
      recipientAllowed
    },
    suppliedDelegate: input.delegate,
    amount: input.amount,
    nowSeconds: latestBlock.timestamp
  });

  // Simulate the exact call to catch contract-level reverts before asking the
  // delegate wallet to sign. Simulation is read-only and sends no transaction.
  await publicClient.simulateContract({
    account: input.delegate,
    address: agentPayAddress,
    abi: agentPayAbi,
    functionName: "spend",
    args: [input.leaseId, input.recipient, input.amount]
  });

  return {
    leaseId: input.leaseId.toString(),
    delegate: input.delegate,
    recipient: input.recipient,
    amountUsdc: input.amountUsdc,
    amountBaseUnits: input.amount.toString(),
    remainingAllowanceUsdc: formatUnits(allowance, 6),
    contract: agentPayAddress,
    chainId: 5042,
    requiresDelegateWalletConfirmation: true
  };
}
