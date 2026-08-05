import { DemandRequest } from './DemandRequest.js';
import { ApprovalDecision } from './ApprovalDecision.js';
import { AllocationDecision } from './AllocationDecision.js';
import { DeliveryConfirmation } from './DeliveryConfirmation.js';
import { FinancialRequestStep } from './FinancialRequestStep.js';
import { SupplyAction } from './SupplyAction.js';

export type AppSchema = {
  DemandRequest: DemandRequest;
  ApprovalDecision: ApprovalDecision;
  AllocationDecision: AllocationDecision;
  DeliveryConfirmation: DeliveryConfirmation;
  FinancialRequestStep: FinancialRequestStep;
  SupplyAction: SupplyAction;
};

export const schema = [
  DemandRequest,
  ApprovalDecision,
  AllocationDecision,
  DeliveryConfirmation,
  FinancialRequestStep,
  SupplyAction,
];
