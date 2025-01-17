import express, { Express, Request, Response } from "express";
import algosdk from "algosdk";
import morgan from "morgan";
import { getAccountByMnemonic, getAlgodClient } from "./utils";
import {
  resolveDID,
  uploadDIDDocument,
  deleteDIDDocument,
  updateDIDDocument,
  getAccountInfo,
  generateNewWallet,
  deploySmartContract,
  createDID,
  resolveDIDById,
} from "./index";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeBox(buf: Buffer): any {
  try {
    return JSON.parse(buf.toString("utf-8"));
  } catch (e: unknown) {
    return { error: "invalid box contents" };
  }
}

const PORT = process.env.SERVER_PORT || 9090;

async function runServer() {
  // setup agent
  const algod = getAlgodClient();
  const app: Express = express();
  app.use(express.json());
  app.use(morgan("dev"));

  // reachability check
  app.get("/health", (req: Request, res: Response) => {
    res.send(
      { message: "Server is up and running" }
    );
  });

  // get algod status
  app.get("/v1/algod_status", async (req: Request, res: Response) => {
    try {
      const status = await algod.status().do();
      res.send(status);
    } catch (error) {
      res.status(400).send({ error: errorMessage(error) });
    }
  });

  // create a wallet
  app.post("/v1/wallet/create", async (req: Request, res: Response) => {
    try {
      const wallet = await generateNewWallet();
      res.send({
        message: "wallet created, fund account and deploy to blockchain to use",
        wallet,
        dispenser: "https://dispenser.testnet.aws.algodev.network",
      });
    } catch (error) {
      res.status(400).send({ error: errorMessage(error) });
    }
  });

  // deploy a smart contract to the blockchain
  app.post("/v1/wallet/deploy", async (req: Request, res: Response) => {
    const { mnemonic } = req.body;
    if (!mnemonic) {
      res.status(400).send({ error: "missing mnemonic" });
      return;
    }

    try {
      const appId = await deploySmartContract(mnemonic, algod);
      res.send({ appId });
    } catch (error) {
      res.status(400).send({ error: errorMessage(error) });
    }
  });

  // get wallet info
  app.post("/v1/wallet/info", async (req: Request, res: Response) => {
    const { mnemonic } = req.body;
    if (!mnemonic) {
      res.status(400).send({ error: "missing mnemonic" });
      return;
    }

    try {
      const accountInfo = await getAccountInfo(mnemonic);
      res.send(accountInfo);
    } catch (error) {
      res.status(400).send({ error: errorMessage(error) });
    }
  });

  // resolve an existing DID by wallet address and app id
  app.post(
    "/v1/did/resolve-by-address",
    async (req: Request, res: Response) => {
      const { address, appId } = req.body;
      if (!address || appId) {
        res
          .status(400)
          .send({ error: "missing address or appId in request body" });
        return;
      }

      try {
        const box: Buffer = await resolveDID(
          `did:algo:${req.params.addr}-${req.params.appId}`,
          algod
        );
        res.send(decodeBox(box));
      } catch (e: unknown) {
        // report any issues as "bad request"
        res.status(400).send({ error: errorMessage(e) });
      }
    }
  );

  // resolve an existing DID by did
  app.post("/v1/did/resolve", async (req: Request, res: Response) => {
    const { did } = req.body;
    if (did) {
      res.status(400).send({ error: "missing did" });
      return;
    }

    try {
      const box: Buffer = await resolveDIDById(did, algod);
      res.send(decodeBox(box));
    } catch (e: unknown) {
      // report any issues as "bad request"
      res.status(400).send({ error: errorMessage(e) });
    }
  });

  // create a new DID
  app.post("/v1/did/create", async (req: Request, res: Response) => {
    const { mnemonic, appId } = req.body;
    if (!mnemonic) {
      res.status(400).send({ error: "missing mnemonic" });
      return;
    }
    if (!appId) {
      res.status(400).send({ error: "missing appId" });
      return;
    }

    try {
      const did = await createDID(mnemonic, Number(appId), algod, "testnet");
      res.send({ ok: true, did });
    } catch (e: unknown) {
      // report any issues as "bad request"
      res.status(400).send({ error: errorMessage(e) });
    }
  });

  // upload a new DID document
  app.post("/v1/:addr/:appId", async (req: Request, res: Response) => {
    const { mnemonic, ...others } = req.body;
    if (!mnemonic) {
      res.status(400).send({ error: "missing mnemonic" });
      return;
    }
    const sender = getAccountByMnemonic(mnemonic);

    try {
      const pk = algosdk.decodeAddress(req.params.addr).publicKey;
      const result = await uploadDIDDocument(
        Buffer.from(JSON.stringify({ ...others })),
        Number(req.params.appId),
        pk,
        sender,
        algod
      );
      res.send({ ok: true, data: result });
    } catch (e: unknown) {
      // report any issues as "bad request"
      res.status(400).send({ error: errorMessage(e) });
    }
  });

  // update/replace an existing DID document
  app.put("/v1/:addr/:appId", async (req: Request, res: Response) => {
    const { mnemonic, ...others } = req.body;
    if (!mnemonic) {
      res.status(400).send({ error: "missing mnemonic" });
      return;
    }
    const sender = getAccountByMnemonic(mnemonic);
    try {
      const pk = algosdk.decodeAddress(req.params.addr).publicKey;
      await updateDIDDocument(
        Buffer.from(JSON.stringify({ ...others })),
        Number(req.params.appId),
        pk,
        sender,
        algod
      );
      res.send({ ok: true });
    } catch (e: unknown) {
      // report any issues as "bad request"
      res.status(400).send({ error: errorMessage(e) });
    }
  });

  // delete an existing DID document
  app.delete("/v1/:addr/:appId", async (req: Request, res: Response) => {
    const { mnemonic } = req.query;
    if (!mnemonic) {
      res.status(400).send({ error: "missing mnemonic" });
      return;
    }
    const sender = getAccountByMnemonic(mnemonic as string);

    try {
      const pk = algosdk.decodeAddress(req.params.addr).publicKey;
      await deleteDIDDocument(Number(req.params.appId), pk, sender, algod);
      res.send({ ok: true });
    } catch (e: unknown) {
      // report any issues as "bad request"
      res.status(400).send({ error: errorMessage(e) });
    }
  });

  // start server
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server started on port: ${PORT}`);
  });
}

runServer();
