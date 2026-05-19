//! Wire-format contract test for `client::notify_issue_started`.
//!
//! Pins the exact HTTP payload the desktop sends to noah-consumer's
//! `/events/issue-started` endpoint. If this drifts (wrong path, missing
//! X-Device-Id, malformed body, wrong content-type), the test fails —
//! catching the class of bug where "the desktop seems to call but
//! nothing arrives" silently.
//!
//! Runs against a wiremock MockServer rather than the real Fly host, so
//! the test is hermetic and fast.
//!
//! All four scenarios live in a single #[tokio::test] because they
//! mutate the process-wide NOAH_CONSUMER_URL env var; running them as
//! separate parallel tests would race. Single-test keeps the dep
//! surface minimal (no serial_test crate).

use noah_desktop_lib::consumer::client::{self, Auth};
use serde_json::Value;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const DEVICE_ID: &str = "test-device-abc123";
const SAMPLE_ENTITLEMENT: &str = r#"{
    "plan": "trial",
    "status": "trialing",
    "trial_started_at": 1000000,
    "trial_ends_at": 1000999,
    "tz_offset_minutes": 300,
    "period_start": null,
    "period_end": null,
    "usage_used": 0,
    "usage_limit": 10,
    "fix_count_total": 0
}"#;

/// Sets NOAH_CONSUMER_URL to point at the given mock and returns a
/// guard that resets it on drop — keeps the test re-runnable.
struct EnvOverride<'a> {
    key: &'a str,
    prev: Option<String>,
}
impl<'a> EnvOverride<'a> {
    fn set(key: &'a str, value: &str) -> Self {
        let prev = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, prev }
    }
}
impl Drop for EnvOverride<'_> {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

#[tokio::test]
async fn notify_issue_started_wire_format() {
    // ── Scenario 1: device auth + tz=300 sends the exact shape ─────
    {
        let server = MockServer::start().await;
        let _env = EnvOverride::set("NOAH_CONSUMER_URL", &server.uri());

        Mock::given(method("POST"))
            .and(path("/events/issue-started"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(SAMPLE_ENTITLEMENT, "application/json"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let auth = Auth::Device(DEVICE_ID);
        client::notify_issue_started(&auth, Some(300))
            .await
            .expect("happy path");

        let received: Vec<Request> = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1, "expected exactly one POST");
        let req = &received[0];

        assert_eq!(req.method, "POST");
        assert_eq!(req.url.path(), "/events/issue-started");

        // Auth: server's requireSessionOrDevice expects X-Device-Id when
        // we're not signed in. Missing this → 401 missing_auth.
        let device_header = req
            .headers
            .get("x-device-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(device_header, DEVICE_ID, "X-Device-Id must match");

        // Content-Type must be JSON or Hono's c.req.json() returns {} and
        // tz_offset_minutes is silently dropped to null.
        let ct = req
            .headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            ct.starts_with("application/json"),
            "unexpected content-type: {ct:?}",
        );

        // Body shape
        let body: Value = serde_json::from_slice(&req.body).expect("body is JSON");
        assert_eq!(
            body.get("tz_offset_minutes"),
            Some(&Value::Number(300.into())),
            "tz_offset_minutes=300 should round-trip",
        );
    }

    // ── Scenario 2: tz=None serialises as JSON null ────────────────
    {
        let server = MockServer::start().await;
        let _env = EnvOverride::set("NOAH_CONSUMER_URL", &server.uri());

        Mock::given(method("POST"))
            .and(path("/events/issue-started"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(SAMPLE_ENTITLEMENT, "application/json"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let auth = Auth::Device(DEVICE_ID);
        client::notify_issue_started(&auth, None)
            .await
            .expect("None tz path");

        let received = server.received_requests().await.unwrap();
        let body: Value = serde_json::from_slice(&received[0].body).unwrap();
        assert_eq!(
            body.get("tz_offset_minutes"),
            Some(&Value::Null),
            "None tz must serialise as null, got {:?}",
            body.get("tz_offset_minutes"),
        );
    }

    // ── Scenario 3: signed-in user sends Bearer instead of device ──
    {
        let server = MockServer::start().await;
        let _env = EnvOverride::set("NOAH_CONSUMER_URL", &server.uri());

        Mock::given(method("POST"))
            .and(path("/events/issue-started"))
            .and(header("authorization", "Bearer session-token-xyz"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(SAMPLE_ENTITLEMENT, "application/json"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let auth = Auth::Session("session-token-xyz");
        client::notify_issue_started(&auth, Some(0))
            .await
            .expect("signed-in path");

        let received = server.received_requests().await.unwrap();
        assert!(
            received[0].headers.get("x-device-id").is_none(),
            "X-Device-Id must not be sent with Auth::Session",
        );
    }

    // ── Scenario 4: non-2xx propagates as a usable error ───────────
    {
        let server = MockServer::start().await;
        let _env = EnvOverride::set("NOAH_CONSUMER_URL", &server.uri());

        Mock::given(method("POST"))
            .and(path("/events/issue-started"))
            .respond_with(ResponseTemplate::new(401))
            .expect(1)
            .mount(&server)
            .await;

        let auth = Auth::Device("bad-device");
        let err = client::notify_issue_started(&auth, Some(0))
            .await
            .expect_err("401 should fail");
        let msg = err.to_string();
        assert!(
            msg.contains("issue-started failed") && msg.contains("401"),
            "error should mention path + status, got: {msg}",
        );
    }
}
