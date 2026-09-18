#!/bin/sh
# Provisions the realm Braid signs people in against.
#
# Idempotent, so a redeploy re-asserts the shape without disturbing users
# who already signed in. Every secret arrives by environment, so nothing
# here holds one.
#
# Google sits behind Keycloak rather than beside it. Braid offers one
# identity provider, so a deployment that adds Keycloak would otherwise
# take Google sign-in away from the people already using it.
set -eu

KC=/opt/keycloak/bin/kcadm.sh
# Reached over the compose network, not through any proxy, so provisioning
# does not wait on the public name resolving.
SERVER=${KEYCLOAK_INTERNAL_URL:-http://keycloak:8080}
REALM=${KEYCLOAK_REALM:-braid}

# The gateway exchanges a caller's token for one Braid accepts, and
# Keycloak resolves the requested audience to a client by its id, so the
# API's own URL has to name a client.
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

# Studio's browser login. Confidential, since Braid holds the secret
# server side and the browser never sees a token it could replay.
upsert_client "$BRAID_OIDC_CLIENT_ID" \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=true \
  -s serviceAccountsEnabled=false \
  -s "secret=$BRAID_OIDC_CLIENT_SECRET" \
  -s "redirectUris=[\"$BRAID_API_URL/auth/oidc/callback\"]" \
  -s "webOrigins=[\"$BRAID_API_URL\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=$BRAID_API_URL/*"

# Named for the API rather than for a person, because its only job is to
# be an audience the exchanged token can carry.
upsert_client "$API_CLIENT" \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=false \
  -s "secret=$KEYCLOAK_API_SECRET"

# What the gateway authenticates as. Token exchange is what lets it turn
# a caller's own token into one Braid accepts, so the caller stays
# themselves rather than collapsing into a shared service identity.
upsert_client "$MCP_CLIENT" \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=false \
  -s serviceAccountsEnabled=true \
  -s "secret=$KEYCLOAK_GATEWAY_SECRET" \
  -s 'attributes."standard.token.exchange.enabled"=true'

# hostedDomain narrows Google to one workspace domain.
# Left empty, any Google account reaches the door,
# and BRAID_ALLOWED_DOMAINS is then the only thing narrowing it.
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

# Keycloak's client-scopes endpoint ignores a name filter and answers with
# the whole list, so matching has to happen here. Asking it to filter and
# taking the first row silently returns an unrelated built-in scope.
scope_id_of () {
  $KC get client-scopes -r "$REALM" --fields id,name --format csv --noquotes 2>/dev/null \
    | grep ",$1\$" | cut -d, -f1 | head -1
}

# Two audiences have to be arranged, and neither client can ask for its own.
#
# An MCP client registers itself, so it cannot know to request the endpoint
# as an audience. A realm default scope gives every client one, including
# a client that appeared without an operator.
#
# The exchange then targets Braid's API, and Keycloak only issues an
# audience the requesting client's scope already covers, so the gateway
# carries a scope naming it.
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

# Nobody signs in against Keycloak itself here, since every account arrives
# from Google. Left alone the browser flow would show a username and password
# form first, so the redirector is given a default and the hop is invisible.
# This covers an MCP client too, which cannot pass `kc_idp_hint` of its own.
# The executions listing carries the config id once one is attached, which
# is the only signal that says whether this has already been done. Asking
# the config endpoint instead answers nothing either way, so a rerun would
# keep adding another.
redirector_row=$($KC get "authentication/flows/browser/executions" -r "$REALM" \
  --fields id,providerId,authenticationConfig --format csv --noquotes 2>/dev/null \
  | grep ",identity-provider-redirector")
redirector=$(echo "$redirector_row" | cut -d, -f1 | head -1)
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
