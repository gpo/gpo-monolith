import "reflect-metadata";
import { Container } from "inversify";
import { ExampleJob } from "../jobs/exampleJob";

// Create DI container
const container = new Container();

// Bind ExampleJob
container.bind<ExampleJob>(ExampleJob).toSelf();

export { container };
