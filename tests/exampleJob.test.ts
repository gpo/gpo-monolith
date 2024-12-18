import { ExampleJob } from "../src/jobs/exampleJob";

describe("ExampleJob", () => {
    it("should execute without errors", () => {
        const job = new ExampleJob();
        expect(() => job.execute()).not.toThrow();
    });
});
