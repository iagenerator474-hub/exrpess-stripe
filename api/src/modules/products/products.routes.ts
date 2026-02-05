import { Router, Request, Response, NextFunction } from "express";
import * as productsService from "./products.service.js";

const router = Router();

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await productsService.listActiveProducts();
    res.status(200).json(products);
  } catch (err) {
    next(err);
  }
});

export const productsRoutes = router;
