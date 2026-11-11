/// Script of the test server's host page: exposes the app side of the runner
/// to `page.evaluate`, as `/design/runner` does in the app.

import { RunnerHost, RunnerUnavailable } from "../host";

Object.assign(window, { __runner: { RunnerHost, RunnerUnavailable } });
