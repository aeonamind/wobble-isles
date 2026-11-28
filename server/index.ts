import { listen } from "colyseus";
import { app } from "./app";

const port = Number(process.env.PORT ?? 2567);

listen(app, port).then(() => {
  console.log(`Wobble Isles server listening on ws://localhost:${port}`);
});
