/* services/refundPolicy.service.js — NEW FILE */

/**
 * Client Policy (from meeting):
 * A) Physical inspection done → Full refund, auto-approved
 * B) No office visit, only email → Case-by-case, manual approval
 */

export const detectRefundScenario = ({ inspectionDone }) => {
  return inspectionDone ? "physical_inspection" : "no_visit_email";
};

export const shouldAutoApprove = (scenario) => {
  return scenario === "physical_inspection";
};

export const buildRefundMessage = (scenario) => {
  if (scenario === "physical_inspection") {
    return "Full refund approved — physical inspection completed.";
  }
  return "Your refund request has been received and will be reviewed by our team.";
};