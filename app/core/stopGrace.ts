// Stop grace period: pause then finish after a brief grace period
export type StopStep = "pause" | "resume" | "stop" | "callEnded";

export class StopGrace {
  static readonly seconds = 5;

  byHangUp: boolean; // call app hung up rather than rep pressing Stop
  wasPaused: boolean; // already paused when Stop came

  constructor(byHangUp: boolean, wasPaused: boolean) {
    this.byHangUp = byHangUp;
    this.wasPaused = wasPaused;
  }

  get onStop(): StopStep[] {
    return this.wasPaused ? [] : ["pause"];
  }

  get onResume(): StopStep[] {
    return this.wasPaused ? [] : ["resume"];
  }

  get onFinish(): StopStep[] {
    return this.byHangUp ? ["callEnded", "stop"] : ["stop"];
  }

  get title(): string {
    return this.byHangUp ? "Call ended" : "Recording stopped";
  }

  get immediate(): boolean {
    return this.byHangUp;
  }
}
