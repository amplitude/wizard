import type { FrameworkConfig } from './framework-config';
import { Integration } from './constants';
import { NEXTJS_AGENT_CONFIG } from '../frameworks/nextjs/nextjs-wizard-agent';
import { VUE_AGENT_CONFIG } from '../frameworks/vue/vue-wizard-agent';
import { REACT_ROUTER_AGENT_CONFIG } from '../frameworks/react-router/react-router-wizard-agent';
import { DJANGO_AGENT_CONFIG } from '../frameworks/django/django-wizard-agent';
import { FLASK_AGENT_CONFIG } from '../frameworks/flask/flask-wizard-agent';
import { FASTAPI_AGENT_CONFIG } from '../frameworks/fastapi/fastapi-wizard-agent';
import { SWIFT_AGENT_CONFIG } from '../frameworks/swift/swift-wizard-agent';
import { ANDROID_AGENT_CONFIG } from '../frameworks/android/android-wizard-agent';
import { PYTHON_AGENT_CONFIG } from '../frameworks/python/python-wizard-agent';
import { JAVASCRIPT_NODE_AGENT_CONFIG } from '../frameworks/javascript-node/javascript-node-wizard-agent';
import { JAVASCRIPT_WEB_AGENT_CONFIG } from '../frameworks/javascript-web/javascript-web-wizard-agent';
import { GENERIC_AGENT_CONFIG } from '../frameworks/generic/generic-wizard-agent';

export const FRAMEWORK_REGISTRY: Record<Integration, FrameworkConfig> = {
  [Integration.nextjs]: NEXTJS_AGENT_CONFIG,
  [Integration.vue]: VUE_AGENT_CONFIG,
  [Integration.reactRouter]: REACT_ROUTER_AGENT_CONFIG,
  [Integration.django]: DJANGO_AGENT_CONFIG,
  [Integration.flask]: FLASK_AGENT_CONFIG,
  [Integration.fastapi]: FASTAPI_AGENT_CONFIG,
  [Integration.swift]: SWIFT_AGENT_CONFIG,
  [Integration.android]: ANDROID_AGENT_CONFIG,
  [Integration.python]: PYTHON_AGENT_CONFIG,
  [Integration.javascriptNode]: JAVASCRIPT_NODE_AGENT_CONFIG,
  [Integration.javascript_web]: JAVASCRIPT_WEB_AGENT_CONFIG,
  [Integration.generic]: GENERIC_AGENT_CONFIG,
};
