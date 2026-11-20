/** A tenant is a casino operator. One operator, one tenant, one set of credentials. */
export type TenantId = string;

export type OperatorCode = string;

export type Tenant = {
  id: TenantId;
  name: string;
  /** Which dialect this operator speaks — the `integration` module resolves it. */
  operator: OperatorCode;
  status: 'active' | 'suspended';
};

export type AuthenticatedOperator = {
  tenantId: TenantId;
  operator: OperatorCode;
  keyId: string;
};
