#!/bin/sh
# Provisions the realm Braid signs people in against.
# Idempotent, so a redeploy re-asserts the shape without disturbing users.
# Every secret arrives by environment, so nothing here holds one.
# Google sits behind Keycloak, not beside it, since Braid offers one provider.
set -eu

KC=/opt/keycloak/bin/kcadm.sh
# Over the compose network, so provisioning never waits on the public name.
SERVER=${KEYCLOAK_INTERNAL_URL:-http://keycloak:8080}
REALM=${KEYCLOAK_REALM:-braid}

# Keycloak resolves a requested audience to a client by its id,
# so the API's own URL has to name a client.
API_CLIENT="$BRAID_API_URL"
MCP_CLIENT="$BRAID_API_URL/braid/mcp"

echo "Waiting for Keycloak..."
until $KC config credentials --server "$SERVER" --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1; do
  sleep 3
done
echo "Keycloak is ready."

if $KC get "realms/$REALM" >/dev/null 2>&1; then
  echo "Realm exists."
else
  $KC create realms -s "realm=$REALM" -s enabled=true
  echo "Realm created."
fi

# Create or update, keyed on clientId, so a rerun does not duplicate.
upsert_client () {
  client_id="$1"
  shift
  existing=$($KC get clients -r "$REALM" -q "clientId=$client_id" --fields id --format csv --noquotes 2>/dev/null | head -1)
  if [ -n "$existing" ]; then
    $KC update "clients/$existing" -r "$REALM" "$@"
    echo "Updated client $client_id"
  else
    $KC create clients -r "$REALM" -s "clientId=$client_id" "$@"
    echo "Created client $client_id"
  fi
}

# Studio's browser login. Confidential, so the browser holds no token.
upsert_client "$BRAID_OIDC_CLIENT_ID" \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=true \
  -s serviceAccountsEnabled=false \
  -s "secret=$BRAID_OIDC_CLIENT_SECRET" \
  -s "redirectUris=[\"$BRAID_API_URL/auth/oidc/callback\"]" \
  -s "webOrigins=[\"$BRAID_API_URL\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=$BRAID_API_URL/*"

# Named for the API, since its only job is to be an audience a token carries.
upsert_client "$API_CLIENT" \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=false \
  -s "secret=$KEYCLOAK_API_SECRET"

# What the gateway authenticates as. Exchange keeps the caller themselves,
# rather than collapsing every call into one service identity.
upsert_client "$MCP_CLIENT" \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=false \
  -s serviceAccountsEnabled=true \
  -s "secret=$KEYCLOAK_GATEWAY_SECRET" \
  -s 'attributes."standard.token.exchange.enabled"=true'

# hostedDomain narrows Google to one workspace domain.
# Left empty, BRAID_ALLOWED_DOMAINS is the only thing narrowing it.
if $KC get identity-provider/instances/google -r "$REALM" >/dev/null 2>&1; then
  $KC update identity-provider/instances/google -r "$REALM" \
    -s "config.clientId=$BRAID_GOOGLE_CLIENT_ID" \
    -s "config.clientSecret=$BRAID_GOOGLE_CLIENT_SECRET"
  echo "Updated Google identity provider."
else
  $KC create identity-provider/instances -r "$REALM" \
    -s alias=google -s providerId=google -s enabled=true \
    -s trustEmail=true \
    -s "config.clientId=$BRAID_GOOGLE_CLIENT_ID" \
    -s "config.clientSecret=$BRAID_GOOGLE_CLIENT_SECRET" \
    -s "config.hostedDomain=${GOOGLE_HOSTED_DOMAIN:-}"
  echo "Created Google identity provider."
fi

# The client-scopes endpoint ignores a name filter and answers with everything,
# so filtering there and taking row one returns an unrelated scope.
scope_id_of () {
  $KC get client-scopes -r "$REALM" --fields id,name --format csv --noquotes 2>/dev/null \
    | grep ",$1\$" | cut -d, -f1 | head -1
}

# Two audiences to arrange, and neither client can ask for its own.
# An MCP client registers itself, so a realm default scope gives it one.
# The exchange then targets the API,
# and Keycloak only issues an audience the client's scope already covers.
upsert_scope () {
  scope_name="$1"
  audience_key="$2"
  audience_value="$3"
  id=$(scope_id_of "$scope_name")
  if [ -z "$id" ]; then
    $KC create client-scopes -r "$REALM" -s "name=$scope_name" -s protocol=openid-connect \
      -s 'attributes."include.in.token.scope"=false'
    id=$(scope_id_of "$scope_name")
    echo "Created client scope $scope_name"
  fi
  mapper=$($KC get "client-scopes/$id/protocol-mappers/models" -r "$REALM" \
    --fields id,name --format csv --noquotes 2>/dev/null \
    | grep ",$scope_name\$" | cut -d, -f1 | head -1)
  if [ -n "$mapper" ]; then
    $KC delete "client-scopes/$id/protocol-mappers/models/$mapper" -r "$REALM"
  fi
  $KC create "client-scopes/$id/protocol-mappers/models" -r "$REALM" \
    -s "name=$scope_name" -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper \
    -s "config.\"$audience_key\"=$audience_value" \
    -s 'config."access.token.claim"=true' \
    -s 'config."introspection.token.claim"=true'
  echo "Set audience on $scope_name"
  SCOPE_ID="$id"
}

upsert_scope braid-mcp-audience included.custom.audience "$MCP_CLIENT"
# Realm default, so a client that registers itself gets it without being told.
$KC update "realms/$REALM/default-default-client-scopes/$SCOPE_ID" >/dev/null 2>&1 || true

upsert_scope braid-api-audience included.client.audience "$API_CLIENT"
mcp_id=$($KC get clients -r "$REALM" -q "clientId=$MCP_CLIENT" --fields id --format csv --noquotes 2>/dev/null | head -1)
$KC update "clients/$mcp_id/default-client-scopes/$SCOPE_ID" -r "$REALM" >/dev/null 2>&1 || true
echo "Gateway can now exchange for the API audience."

# Every account arrives from Google, so the username form is a dead hop.
# A default on the redirector skips it, for an MCP client too,
# which cannot pass `kc_idp_hint` of its own.
redirector_row=$($KC get "authentication/flows/browser/executions" -r "$REALM" \
  --fields id,providerId,authenticationConfig --format csv --noquotes 2>/dev/null \
  | grep ",identity-provider-redirector")
redirector=$(echo "$redirector_row" | cut -d, -f1 | head -1)
# The listing carries the config id once attached,
# which is the only signal saying whether this ran before.
# The config endpoint answers neither way.
existing=$(echo "$redirector_row" | cut -d, -f3 | head -1)
if [ -n "$redirector" ]; then
  if [ -z "$existing" ]; then
    $KC create "authentication/executions/$redirector/config" -r "$REALM" \
      -s alias=google-by-default \
      -s config.defaultProvider=google
    echo "Browser sign-in now goes straight to Google."
  else
    echo "Browser sign-in already has a default provider."
  fi
else
  echo "WARNING: could not find the identity provider redirector."
fi

echo "Done."
