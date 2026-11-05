#include <bits/stdc++.h>
#include <hyprland/src/plugins/PluginAPI.hpp>
// The screenshare render entry point and scene renderer are internal APIs.
// This plugin is deliberately tied to the exact compositor build hash.
#define private public
#define protected public
#include <hyprland/src/desktop/rule/layerRule/LayerRuleApplicator.hpp>
#include <hyprland/src/desktop/rule/windowRule/WindowRuleApplicator.hpp>
#include <hyprland/src/desktop/view/Window.hpp>
#include <hyprland/src/managers/screenshare/ScreenshareManager.hpp>
#include <hyprland/src/xwayland/XWayland.hpp>
#undef private
#undef protected
#include <hyprland/src/config/shared/actions/ConfigActions.hpp>
#include <hyprland/src/desktop/state/WindowState.hpp>
#include <hyprland/src/event/EventBus.hpp>
#include <hyprland/src/managers/input/InputManager.hpp>
#include <hyprland/src/pointer/PointerManager.hpp>
#include <hyprland/src/xwayland/XSurface.hpp>
#include <xcb/shape.h>

static_assert(std::string_view(GIT_TAG) == "v0.56.2",
              "Review internal APIs before porting this plugin");

namespace {
HANDLE handle;
CFunctionHook *monitorHook, *windowHook, *layerHook, *fadeHook;
bool capturing = false;
uint64_t frames = 0;
SP<SHyprCtlCommand> statusCommand;
SP<SHyprCtlCommand> pinCommand;
SP<SHyprCtlCommand> geometryCommand;
SP<SHyprCtlCommand> inputCommand;
// Reserved for this exact-build companion; keep other compositor block reasons
// intact.
constexpr auto GHOST_INPUT_BLOCK =
    static_cast<Desktop::View::eWindowInputBlockReason>(1 << 7);
std::vector<WP<Desktop::View::CWindow>> ghostInputWindows;
CHyprSignalListener pointerListener;

void inputShape(PHLWINDOW win, bool blocked) {
  if (!g_pXWayland || !g_pXWayland->m_wm || !win->m_xwaylandSurface)
    return;
  const auto connection = g_pXWayland->m_wm->getConnection();
  if (!connection)
    return;
  if (blocked) {
    xcb_shape_rectangles(connection, XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT,
                         XCB_CLIP_ORDERING_UNSORTED,
                         win->m_xwaylandSurface->m_xID, 0, 0, 0, nullptr);
  } else {
    // Reset to the default input shape so it follows subsequent window resizes.
    xcb_shape_mask(connection, XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT,
                   win->m_xwaylandSurface->m_xID, 0, 0, XCB_PIXMAP_NONE);
  }
  xcb_flush(connection);
}

void updateGhostInputs(const Vector2D &cursor, bool forceShape = false) {
  if (g_pInputManager->hasHeldButtons() && !forceShape)
    return;
  for (const auto &weak : ghostInputWindows) {
    const auto win = weak.lock();
    if (!win || !win->m_isMapped || !win->m_xwaylandSurface)
      continue;
    const auto pos =
        win->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    const auto size = win->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    const auto client = win->m_xwaylandSurface->m_geometry.size();
    if (size.x <= 0 || size.y <= 0)
      continue;
    const double x = (cursor.x - pos.x) * client.x / size.x;
    const double y = (cursor.y - pos.y) * client.y / size.y;
    const bool toolbar = x >= 0 && x < client.x && y >= 0 && y < 31;
    const bool corner = x >= client.x - 23 && x < client.x &&
                        y >= client.y - 23 && y < client.y;
    const bool blocked = !(toolbar || corner);
    const bool wasBlocked =
        win->isInputBlockedReasonAnyOf(static_cast<uint8_t>(GHOST_INPUT_BLOCK));
    if (blocked != wasBlocked)
      win->setInputBlocked(GHOST_INPUT_BLOCK, blocked);
    if (forceShape || blocked != wasBlocked)
      inputShape(win, blocked);
  }
}

std::string input(eHyprCtlOutputFormat, std::string request) {
  std::istringstream args(request);
  std::string command, trailing;
  uint32_t xid;
  int blocked;
  if (!(args >> command >> xid >> blocked) || (blocked != 0 && blocked != 1))
    return "invalid arguments";
  int enabled = blocked;
  if (args >> enabled) {
    if ((enabled != 0 && enabled != 1) || args >> trailing)
      return "invalid arguments";
  } else if (!args.eof())
    return "invalid arguments";
  std::erase_if(ghostInputWindows,
                [](const auto &win) { return win.expired(); });
  for (const auto &win : Desktop::windowState()->windows()) {
    if (!win->m_isMapped || !win->m_xwaylandSurface ||
        win->m_xwaylandSurface->m_xID != xid)
      continue;
    if (win->m_initialTitle != "Ghost Notes Note" ||
        (win->m_initialClass != "com.invisiblenotes.app" &&
         win->m_initialClass != "invisible-notes"))
      return "not a note";
    std::erase_if(ghostInputWindows,
                  [&](const auto &entry) { return entry.lock() == win; });
    if (enabled) {
      ghostInputWindows.emplace_back(win);
      updateGhostInputs(g_pInputManager->getMouseCoordsInternal(), true);
    } else {
      win->setInputBlocked(GHOST_INPUT_BLOCK, false);
      inputShape(win, false);
    }
    g_pInputManager->simulateMouseMovement();
    return std::format("{{\"x\":0,\"y\":0,\"blocked\":{}}}",
                       static_cast<bool>(blocked));
  }
  return "{\"x\":0,\"y\":0,\"mapped\":false}";
}

std::string geometry(eHyprCtlOutputFormat, std::string request) {
  std::istringstream input(request);
  std::string command, trailing;
  uint32_t xid;
  if (!(input >> command >> xid) || input >> trailing)
    return "invalid arguments";
  for (const auto &win : Desktop::windowState()->windows()) {
    if (!win->m_isMapped || !win->m_xwaylandSurface ||
        win->m_xwaylandSurface->m_xID != xid ||
        win->m_initialTitle != "Ghost Notes Note")
      continue;
    const auto pos =
        win->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    const auto size = win->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    return std::format("{{\"x\":{},\"y\":{},\"width\":{},\"height\":{}}}",
                       pos.x, pos.y, size.x, size.y);
  }
  return "not-mapped";
}

std::string pin(eHyprCtlOutputFormat, std::string request) {
  std::istringstream input(request);
  std::string command, trailing;
  uint32_t xid;
  int enabled;
  if (!(input >> command >> xid >> enabled) || (enabled != 0 && enabled != 1) ||
      input >> trailing)
    return "invalid arguments";
  for (const auto &win : Desktop::windowState()->windows()) {
    if (!win->m_isMapped || !win->m_xwaylandSurface ||
        win->m_xwaylandSurface->m_xID != xid)
      continue;
    if (win->m_initialTitle != "Ghost Notes Note" ||
        (win->m_initialClass != "com.invisiblenotes.app" &&
         win->m_initialClass != "invisible-notes"))
      return "not a note";
    const auto result = Config::Actions::pinWindow(
        enabled ? Config::Actions::TOGGLE_ACTION_ENABLE
                : Config::Actions::TOGGLE_ACTION_DISABLE,
        win);
    return result ? "ok" : "pin failed";
  }
  return "not-mapped";
}

std::string status(eHyprCtlOutputFormat, std::string) {
  return std::string("{\"mode\":\"compositor-omit\",\"frames\":") +
         std::to_string(frames) + ",\"hash\":\"" GIT_COMMIT_HASH "\"}";
}

using WindowFn = void (*)(Render::IHyprRenderer *, PHLWINDOW, PHLMONITOR,
                          const Time::steady_tp &, bool,
                          Render::eRenderPassMode, bool, bool);
using LayerFn = void (*)(Render::IHyprRenderer *, PHLLS, PHLMONITOR,
                         const Time::steady_tp &, bool, bool);
using FadeFn = void (*)(Render::IHyprRenderer *, PHLMONITOR,
                        Desktop::eFadeoutPlane, PHLWORKSPACE);

void window(Render::IHyprRenderer *renderer, PHLWINDOW win, PHLMONITOR mon,
            const Time::steady_tp &now, bool decorate,
            Render::eRenderPassMode mode, bool ignorePosition,
            bool standalone) {
  if (capturing && win &&
      win->m_ruleApplicator->noScreenShare().valueOrDefault())
    return;
  reinterpret_cast<WindowFn>(windowHook->m_original)(
      renderer, win, mon, now, decorate, mode, ignorePosition, standalone);
}

void layer(Render::IHyprRenderer *renderer, PHLLS surface, PHLMONITOR mon,
           const Time::steady_tp &now, bool popups, bool lockscreen) {
  if (capturing && surface &&
      surface->m_ruleApplicator->noScreenShare().valueOrDefault())
    return;
  reinterpret_cast<LayerFn>(layerHook->m_original)(renderer, surface, mon, now,
                                                   popups, lockscreen);
}

void fade(Render::IHyprRenderer *renderer, PHLMONITOR mon,
          Desktop::eFadeoutPlane plane, PHLWORKSPACE workspace) {
  // Fadeout snapshots have no privacy metadata. Never sample them into
  // captures.
  if (!capturing)
    reinterpret_cast<FadeFn>(fadeHook->m_original)(renderer, mon, plane,
                                                   workspace);
}

void monitor(Screenshare::CScreenshareFrame *frame) {
  const auto session = frame->m_session;
  if (!session || frame->done())
    return;
  const auto mon = session->monitor();
  if (!mon)
    return;
  auto *renderer = g_pHyprRenderer.get();
  const auto now = Time::steadyNow();
  const auto oldFeedback = renderer->m_bBlockSurfaceFeedback;
  renderer->m_bBlockSurfaceFeedback = true;
  renderer->m_renderData.transformDamage = false;
  renderer->m_renderData.noSimplify = true;
  renderer->setProjectionType(frame->m_bufferSize);
  renderer->setViewport(0, 0, frame->m_bufferSize.x, frame->m_bufferSize.y);
  renderer->startRenderPass();
  capturing = true;
  const CBox geometry{-session->m_captureBox.pos(), mon->m_pixelSize};
  renderer->renderWorkspace(mon, mon->m_activeWorkspace, now, geometry);
  renderer->renderLockscreen(mon, now, geometry);
  renderer->renderIME(mon, now, geometry);
  capturing = false;
  renderer->m_bBlockSurfaceFeedback = oldFeedback;

  // Cached precomputed blur belongs to the physical scene, which includes
  // notes. Force live blur of this clean scene instead, without updating that
  // cache.
  auto &pass = renderer->m_renderPass;
  pass.removeAllOfType("CPreBlurElement");
  for (auto &entry : pass.m_passElements) {
    if (auto *surface =
            dynamic_cast<CSurfacePassElement *>(entry.element.get()))
      surface->m_data.blockBlurOptimization = true;
    if (auto *texture = dynamic_cast<CTexPassElement *>(entry.element.get()))
      texture->m_data.blockBlurOptimization = true;
    if (auto *rect = dynamic_cast<CRectPassElement *>(entry.element.get()))
      rect->m_data.xray = false;
  }
  if (frame->m_overlayCursor) {
    CRegion damage{0, 0, INT16_MAX, INT16_MAX};
    const auto pos = g_pInputManager->getMouseCoordsInternal() -
                     mon->m_position -
                     session->m_captureBox.pos() / mon->m_scale;
    Pointer::mgr()->renderSoftwareCursorsFor(mon, now, damage, pos, true);
  }
  ++frames;
}

CFunctionHook *hook(const std::string &name, void *replacement) {
  auto matches = HyprlandAPI::findFunctionsByName(
      handle, name.substr(name.rfind("::") + 2));
  std::erase_if(matches, [&](const auto &match) {
    return !match.demangled.contains(name + "(");
  });
  if (matches.size() != 1)
    throw std::runtime_error("Ghost Notes: ambiguous or missing symbol " +
                             name);
  auto *result = HyprlandAPI::createFunctionHook(
      handle, matches.front().address, replacement);
  if (!result || !result->hook())
    throw std::runtime_error("Ghost Notes: cannot hook " + name);
  return result;
}
} // namespace

APICALL EXPORT std::string PLUGIN_API_VERSION() { return HYPRLAND_API_VERSION; }

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE pluginHandle) {
  handle = pluginHandle;
  if (HyprlandAPI::getHyprlandVersion(handle).hash != GIT_COMMIT_HASH)
    throw std::runtime_error("Ghost Notes capture plugin needs rebuilding for "
                             "this Hyprland version");
  windowHook =
      hook("IHyprRenderer::renderWindow", reinterpret_cast<void *>(window));
  layerHook =
      hook("IHyprRenderer::renderLayer", reinterpret_cast<void *>(layer));
  fadeHook =
      hook("IHyprRenderer::renderFadeouts", reinterpret_cast<void *>(fade));
  monitorHook = hook("CScreenshareFrame::renderMonitor",
                     reinterpret_cast<void *>(monitor));
  statusCommand = HyprlandAPI::registerHyprCtlCommand(
      handle, {"ghostnotes:status", true, status});
  if (!statusCommand)
    throw std::runtime_error("Ghost Notes: cannot register capture status");
  pinCommand = HyprlandAPI::registerHyprCtlCommand(
      handle, {"ghostnotes:pin", false, pin});
  if (!pinCommand)
    throw std::runtime_error("Ghost Notes: cannot register pin integration");
  geometryCommand = HyprlandAPI::registerHyprCtlCommand(
      handle, {"ghostnotes:geometry", false, geometry});
  if (!geometryCommand)
    throw std::runtime_error(
        "Ghost Notes: cannot register geometry integration");
  inputCommand = HyprlandAPI::registerHyprCtlCommand(
      handle, {"ghostnotes:input", false, input});
  if (!inputCommand)
    throw std::runtime_error("Ghost Notes: cannot register input integration");
  pointerListener = Event::bus()->m_events.input.mouse.move.listen(
      [](const Vector2D &point, Event::SCallbackInfo &) {
        updateGhostInputs(point);
      });
  return {"ghost-notes-capture",
          "Omit protected surfaces from compositor captures", "Ghost Notes",
          "0.1.0"};
}

APICALL EXPORT void PLUGIN_EXIT() {
  pointerListener.reset();
  for (const auto &weak : ghostInputWindows) {
    if (const auto win = weak.lock()) {
      win->setInputBlocked(GHOST_INPUT_BLOCK, false);
      inputShape(win, false);
    }
  }
  ghostInputWindows.clear();
}
