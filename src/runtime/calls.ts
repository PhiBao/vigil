import { encodeFunctionData, type Address, type Hex } from "viem";
import { erc20Abi, vTokenAbi } from "../scanner/abis";
import { ADDRESSES } from "../config";
import { toBaseUnits } from "../lib/money";

/**
 * Call builders. Every action here is inside the agent allowlists (the
 * session's `calls` set), so executing these can never move funds outside the
 * user's own positions. Amounts are base units (18 decimals on BSC).
 */

export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
}

/** ERC-20 approve (spender = the protocol contract that pulls tokens). */
export function approve(token: Address, spender: Address, amount: bigint): Call {
  return {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  };
}

/** Venus supply: approve the vToken to pull underlying, then mint vTokens. */
export function venusSupply(vToken: Address, underlying: Address, amountUsd: number): Call[] {
  const amount = toBaseUnits(amountUsd);
  return [
    approve(underlying, vToken, amount),
    {
      to: vToken,
      data: encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "mint",
            stateMutability: "nonpayable",
            inputs: [{ type: "uint256", name: "mintAmount" }],
            outputs: [{ type: "uint256", name: "" }],
          },
        ],
        functionName: "mint",
        args: [amount],
      }),
    },
  ];
}

/** Venus repay: approve vToken to pull underlying, then repayBorrow. */
export function venusRepay(vToken: Address, underlying: Address, amountUsd: number): Call[] {
  const amount = toBaseUnits(amountUsd);
  return [
    approve(underlying, vToken, amount),
    {
      to: vToken,
      data: encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "repayBorrow",
            stateMutability: "nonpayable",
            inputs: [{ type: "uint256", name: "repayAmount" }],
            outputs: [{ type: "uint256", name: "" }],
          },
        ],
        functionName: "repayBorrow",
        args: [amount],
      }),
    },
  ];
}

/** Venus borrow: vToken.borrow(amount) — increases debt (used by Proving Ground setup). */
export function venusBorrow(vToken: Address, amountUsd: number): Call {
  const amount = toBaseUnits(amountUsd);
  return {
    to: vToken,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "borrow",
          stateMutability: "nonpayable",
          inputs: [{ type: "uint256", name: "borrowAmount" }],
          outputs: [{ type: "uint256", name: "" }],
        },
      ],
      functionName: "borrow",
      args: [amount],
    }),
  };
}

/** Aave v3 supply: approve pool, then pool.supply. */
export function aaveSupply(pool: Address, asset: Address, amountUsd: number, onBehalfOf: Address): Call[] {
  const amount = toBaseUnits(amountUsd);
  return [
    approve(asset, pool, amount),
    {
      to: pool,
      data: encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "supply",
            stateMutability: "nonpayable",
            inputs: [
              { type: "address", name: "asset" },
              { type: "uint256", name: "amount" },
              { type: "address", name: "onBehalfOf" },
              { type: "uint16", name: "referralCode" },
            ],
            outputs: [],
          },
        ],
        functionName: "supply",
        args: [asset, amount, onBehalfOf, 0],
      }),
    },
  ];
}

/** Aave v3 repay (variable rate mode = 2). */
export function aaveRepay(pool: Address, asset: Address, amountUsd: number, wallet: Address): Call[] {
  const amount = toBaseUnits(amountUsd);
  return [
    approve(asset, pool, amount),
    {
      to: pool,
      data: encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "repay",
            stateMutability: "nonpayable",
            inputs: [
              { type: "address", name: "asset" },
              { type: "uint256", name: "amount" },
              { type: "uint256", name: "interestRateMode" },
              { type: "address", name: "onBehalfOf" },
            ],
            outputs: [{ type: "uint256", name: "" }],
          },
        ],
        functionName: "repay",
        args: [asset, amount, 2n, wallet],
      }),
    },
  ];
}

export const WBNB = ADDRESSES.wbnb;
export const USDT = ADDRESSES.usdt;
export const USDC = ADDRESSES.usdc;

/** PancakeSwap V3 NPM: decrease liquidity (close part of a position). */
export function v3DecreaseLiquidity(
  npm: Address,
  tokenId: bigint,
  liquidity: bigint,
  amount0Min = 0n,
  amount1Min = 0n,
): Call {
  return {
    to: npm,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "decreaseLiquidity",
          stateMutability: "nonpayable",
          inputs: [
            {
              type: "tuple",
              name: "params",
              components: [
                { type: "uint256", name: "tokenId" },
                { type: "uint128", name: "liquidity" },
                { type: "uint256", name: "amount0Min" },
                { type: "uint256", name: "amount1Min" },
                { type: "uint256", name: "deadline" },
              ],
            },
          ],
          outputs: [
            { type: "uint256", name: "amount0" },
            { type: "uint256", name: "amount1" },
          ],
        },
      ],
      functionName: "decreaseLiquidity",
      args: [{ tokenId, liquidity, amount0Min, amount1Min, deadline: BigInt(Math.floor(Date.now() / 1000) + 1200) }],
    }),
  };
}

/** PancakeSwap V3 NPM: collect fees + liquidity as underlying. */
export function v3Collect(
  npm: Address,
  tokenId: bigint,
  recipient: Address,
  amount0Max = 2n ** 128n - 1n,
  amount1Max = 2n ** 128n - 1n,
): Call {
  return {
    to: npm,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "collect",
          stateMutability: "nonpayable",
          inputs: [
            {
              type: "tuple",
              name: "params",
              components: [
                { type: "uint256", name: "tokenId" },
                { type: "address", name: "recipient" },
                { type: "uint128", name: "amount0Max" },
                { type: "uint128", name: "amount1Max" },
              ],
            },
          ],
          outputs: [
            { type: "uint256", name: "amount0" },
            { type: "uint256", name: "amount1" },
          ],
        },
      ],
      functionName: "collect",
      args: [{ tokenId, recipient, amount0Max, amount1Max }],
    }),
  };
}

/** PancakeSwap V3 NPM: mint a new position around given ticks. */
export function v3Mint(
  npm: Address,
  params: {
    token0: Address;
    token1: Address;
    fee: number;
    tickLower: number;
    tickUpper: number;
    amount0Desired: bigint;
    amount1Desired: bigint;
    recipient: Address;
  },
): Call {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  return {
    to: npm,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "mint",
          stateMutability: "nonpayable",
          inputs: [
            {
              type: "tuple",
              name: "params",
              components: [
                { type: "address", name: "token0" },
                { type: "address", name: "token1" },
                { type: "uint24", name: "fee" },
                { type: "int24", name: "tickLower" },
                { type: "int24", name: "tickUpper" },
                { type: "uint256", name: "amount0Desired" },
                { type: "uint256", name: "amount1Desired" },
                { type: "uint256", name: "amount0Min" },
                { type: "uint256", name: "amount1Min" },
                { type: "address", name: "recipient" },
                { type: "uint256", name: "deadline" },
              ],
            },
          ],
          outputs: [
            { type: "uint256", name: "tokenId" },
            { type: "uint128", name: "liquidity" },
            { type: "uint256", name: "amount0" },
            { type: "uint256", name: "amount1" },
          ],
        },
      ],
      functionName: "mint",
      args: [
        {
          ...params,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline,
        },
      ],
    }),
  };
}

/** PancakeSwap V3 SwapRouter: exactInputSingle (bounded by slippage). */
export function v3ExactInputSingle(
  router: Address,
  params: {
    tokenIn: Address;
    tokenOut: Address;
    fee: number;
    recipient: Address;
    amountIn: bigint;
    amountOutMinimum: bigint;
  },
): Call {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  return {
    to: router,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "exactInputSingle",
          stateMutability: "nonpayable",
          inputs: [
            {
              type: "tuple",
              name: "params",
              components: [
                { type: "address", name: "tokenIn" },
                { type: "address", name: "tokenOut" },
                { type: "uint24", name: "fee" },
                { type: "address", name: "recipient" },
                { type: "uint256", name: "deadline" },
                { type: "uint256", name: "amountIn" },
                { type: "uint256", name: "amountOutMinimum" },
                { type: "uint160", name: "sqrtPriceLimitX96" },
              ],
            },
          ],
          outputs: [{ type: "uint256", name: "amountOut" }],
        },
      ],
      functionName: "exactInputSingle",
      args: [{ ...params, deadline, sqrtPriceLimitX96: 0n }],
    }),
  };
}
