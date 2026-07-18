package failure

import "testing"

func TestForScenarioMapsBehavior(t *testing.T) {
	f, err := ForScenario(ScenarioPaymentSlowdown, 2)
	if err != nil || f.PaymentExtraLatencyMs != 1800 {
		t.Fatalf("slowdown mapping wrong: %+v err=%v", f, err)
	}
	f, _ = ForScenario(ScenarioPaymentErrorSpike, 3)
	if f.PaymentFailureRatePct != 60 {
		t.Fatalf("error spike mapping wrong: %+v", f)
	}
	f, _ = ForScenario(ScenarioTrafficSurge, 1)
	if f.TrafficMultiplier != 2 {
		t.Fatalf("surge mapping wrong: %+v", f)
	}
	f, _ = ForScenario(ScenarioFullRecovery, 2)
	if f.ActiveScenario != ScenarioNormal || f.PaymentExtraLatencyMs != 0 {
		t.Fatalf("recovery must clear flags: %+v", f)
	}
	if _, err := ForScenario("nope", 2); err == nil {
		t.Fatal("unknown scenario must error")
	}
}

func TestForScenarioClampsIntensity(t *testing.T) {
	f, _ := ForScenario(ScenarioPaymentSlowdown, 99)
	if f.PaymentExtraLatencyMs != 1800 {
		t.Fatalf("intensity clamp failed: %+v", f)
	}
}

func TestConflicts(t *testing.T) {
	cur, _ := ForScenario(ScenarioPaymentSlowdown, 2)
	if !Conflicts(cur, ScenarioNotificationOutage) {
		t.Fatal("two standing failures must conflict")
	}
	if Conflicts(cur, ScenarioTrafficSurge) {
		t.Fatal("surge should layer on failures")
	}
	if Conflicts(cur, ScenarioFullRecovery) {
		t.Fatal("recovery never conflicts")
	}
	if Conflicts(Flags{}, ScenarioNotificationOutage) {
		t.Fatal("healthy state accepts any scenario")
	}
	if Conflicts(cur, ScenarioPaymentSlowdown) {
		t.Fatal("re-running the same scenario is allowed (intensity change)")
	}
}
