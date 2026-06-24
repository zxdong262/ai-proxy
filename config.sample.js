/**
 * Multi-service configuration.
 *
 * Copy this file to config.js and edit to configure multiple remote AI services.
 * Each route is exposed as /<name>/v1/messages and /<name>/v1/*.
 */
export default {
  routes: [
    {
      name: "atlascloud",
      remote_api_url: "https://api.atlascloud.ai/v1",
      messages_endpoint: "/chat/completions",
      auth_type: "bearer",
      api_key: "your_api_key_here_optional",
    },
    {
      name: "openai",
      remote_api_url: "https://api.openai.com/v1",
      messages_endpoint: "/chat/completions",
      auth_type: "bearer",
      api_key: "your_api_key_here_optional",
    },
  ],
};
