import {container} from "./di/container";
import {ExampleJob} from "./jobs/exampleJob";

// Resolve and execute ExampleJob
const exampleJob = container.get(ExampleJob);
(async () => {
    await exampleJob.execute();
})();