import _ from 'lodash'
import { DiagramEngine, DiagramModel, DiagramWidget, LinkModel, NodeModel, PointModel } from 'storm-react-diagrams'
import { hashCode } from '~/util'

import { SkillCallNodeModel } from './nodes/SkillCallNode'
import { StandardNodeModel } from './nodes/StandardNode'

const passThroughNodeProps: string[] = ['name', 'onEnter', 'onReceive', 'next', 'skill']
export const DIAGRAM_PADDING: number = 100

export const createNodeModel = (node, props) => {
  if (node.type && node.type === 'skill-call') {
    return new SkillCallNodeModel({ ...props })
  } else {
    return new StandardNodeModel({ ...props })
  }
}

export class DiagramManager {
  private diagramEngine: DiagramEngine
  private activeModel: ExtendedDiagramModel
  private diagramWidget: DiagramWidget
  private highlightedNodeName?: string
  private currentFlow: CurrentFlow
  private isReadOnly: boolean
  private diagramContainerSize: DiagramContainerSize
  private storeDispatch

  constructor(engine, storeActions) {
    this.diagramEngine = engine
    this.storeDispatch = storeActions
  }

  initializeModel() {
    this.activeModel = new DiagramModel()
    this.activeModel.setGridSize(5)
    this.activeModel.linksHash = null
    this.activeModel.setLocked(this.isReadOnly)

    const currentFlow = this.currentFlow
    if (!currentFlow) {
      return
    }

    const nodes = currentFlow.nodes.map(node => {
      const model = createNodeModel(node, {
        ...node,
        isStartNode: currentFlow.startNode === node.name,
        isHighlighted: this.highlightedNodeName === node.name
      })
      model.x = model.oldX = node.x
      model.y = model.oldY = node.y

      return model
    })

    this.activeModel.addAll(...nodes)
    nodes.forEach(node => this._createNodeLinks(node, nodes, this.currentFlow.links))

    this.diagramEngine.setDiagramModel(this.activeModel)
    this._updateZoomLevel(nodes)
  }

  // Syncs model with the store (only update changes instead of complete initialization)
  syncModel() {
    // Don't serialize more than once
    const snapshot = _.once(this._serialize)

    // Remove nodes that have been deleted
    _.keys(this.activeModel.getNodes()).forEach(nodeId => {
      if (!_.find(this.currentFlow.nodes, { id: nodeId })) {
        this._deleteNode(nodeId)
      }
    })

    this.currentFlow &&
      this.currentFlow.nodes.forEach(node => {
        const model = this.activeModel.getNode(node.id) as BpNodeModel
        if (!model) {
          // Node doesn't exist
          this._addNode(node)
        } else if (model.lastModified !== node.lastModified) {
          // Node has been modified
          this._syncNode(node, model, snapshot())
        } else {
          // @ts-ignore
          model.setData({
            ..._.pick(node, passThroughNodeProps),
            isStartNode: this.currentFlow.startNode === node.name,
            isHighlighted: this.highlightedNodeName === node.name
          })
        }
      })

    this.cleanPortLinks()
    this.activeModel.setLocked(this.isReadOnly)
    this.diagramWidget.forceUpdate()
  }

  clearModel() {
    this.activeModel = new DiagramModel()
    this.activeModel.setGridSize(5)
    this.activeModel.linksHash = null
    this.activeModel.setLocked(this.isReadOnly)

    this.diagramEngine.setDiagramModel(this.activeModel)
    this.diagramWidget && this.diagramWidget.forceUpdate()
  }

  disconnectPorts(model: any) {
    const ports = model.getPorts()

    Object.keys(ports).forEach(p => {
      _.values(ports[p].links).forEach(link => {
        this.activeModel.removeLink(link)
        ports[p].removeLink(link)
      })
    })
  }

  sanitizeLinks() {
    // Sanitizing the links, making sure that:
    // 1) All links are connected to ONE [out] and [in] port
    // 2) All ports have only ONE outbound link
    const links = _.values(this.activeModel.getLinks())
    links.forEach(link => {
      // If there's not two ports attached to the link
      if (!link.getSourcePort() || !link.getTargetPort()) {
        link.remove()
        return this.diagramWidget.forceUpdate()
      }

      // We need at least one input port
      if (link.getSourcePort().name !== 'in' && link.getTargetPort().name !== 'in') {
        link.remove()
        return this.diagramWidget.forceUpdate()
      }

      // We need at least one output port
      if (!link.getSourcePort().name.startsWith('out') && !link.getTargetPort().name.startsWith('out')) {
        link.remove()
        return this.diagramWidget.forceUpdate()
      }

      // If ports have more than one outbout link
      const ports = [link.getSourcePort(), link.getTargetPort()]
      ports.forEach(port => {
        if (!port) {
          return
        }
        const portLinks = _.values(port.getLinks())
        if (port.name.startsWith('out') && portLinks.length > 1) {
          _.last(portLinks).remove()
          this.diagramWidget.forceUpdate()
        }
      })

      // We don't want to link node to itself
      const outPort = link.getSourcePort().name.startsWith('out') ? link.getSourcePort() : link.getTargetPort()
      const targetPort = link.getSourcePort().name.startsWith('out') ? link.getTargetPort() : link.getSourcePort()
      if (outPort.getParent().getID() === targetPort.getParent().getID()) {
        link.remove()
        return this.diagramWidget.forceUpdate()
      }
    })
  }

  getRealPosition(event) {
    let { x, y } = this.diagramEngine.getRelativePoint(event.x || event.clientX, event.y || event.clientY)

    const zoomFactor = this.activeModel.getZoomLevel() / 100

    x /= zoomFactor
    y /= zoomFactor

    x -= this.activeModel.getOffsetX() / zoomFactor
    y -= this.activeModel.getOffsetY() / zoomFactor

    return { x, y }
  }

  cleanPortLinks() {
    const allLinkIds = _.values(this.activeModel.getLinks()).map(x => x.getID())

    // Loops through all nodes to extract all their ports
    const allPorts = _.flatten(
      _.values(this.activeModel.getNodes())
        .map(x => x.ports)
        .map(_.values)
    )

    // For each ports, if it has an invalid link, it will be removed
    allPorts.map(port =>
      Object.keys(port.links)
        .filter(x => !allLinkIds.includes(x))
        .map(x => port.links[x].remove())
    )
  }

  getLinksRequiringUpdate() {
    const newLinks = this._serializeLinks()
    const newLinksHash = hashCode(JSON.stringify(newLinks))

    if (!this.activeModel.linksHash || this.activeModel.linksHash !== newLinksHash) {
      this.activeModel.linksHash = newLinksHash
      return newLinks
    }
  }

  getActiveModelOffset(): { offsetX: number; offsetY: number } {
    return { offsetX: this.activeModel.offsetX, offsetY: this.activeModel.offsetY }
  }

  setCurrentFlow(currentFlow: CurrentFlow) {
    this.currentFlow = currentFlow
  }

  setHighlightedNodeName(nodeName: string) {
    this.highlightedNodeName = nodeName
  }

  setReadOnly(readOnly: boolean) {
    this.isReadOnly = readOnly
  }

  setDiagramContainer(diagramWidget, diagramContainerSize: DiagramContainerSize) {
    this.diagramContainerSize = diagramContainerSize
    this.diagramWidget = diagramWidget
  }

  getSelectedNode() {
    return _.first(this.activeModel.getSelectedItems() || [])
  }

  unselectAllElements() {
    this.activeModel.getSelectedItems().map(x => x.setSelected(false))
  }

  getNodeProblems(): NodeProblem[] {
    const nodes = this.activeModel.getNodes()
    return Object.keys(nodes)
      .map(node => ({
        nodeName: (nodes[node] as BpNodeModel).name,
        missingPorts: (nodes[node] as BpNodeModel).next.filter(n => n.node === '').length
      }))
      .filter(x => x.missingPorts > 0)
  }

  private _deleteNode(nodeId: string) {
    const ports = this.activeModel.getNode(nodeId).getPorts()
    this.activeModel.removeNode(nodeId)

    _.values(ports).forEach(port => {
      _.values(port.getLinks()).forEach(link => {
        this.activeModel.removeLink(link)
      })
    })
  }

  private _addNode(node: BpNodeModel) {
    const model = createNodeModel(node, { ...node, isStartNode: this.currentFlow.startNode === node.name })
    model.x = model.oldX = node.x
    model.y = model.oldY = node.y
    this.activeModel.addNode(model)

    setTimeout(() => {
      // Select newly inserted nodes
      model.setSelected(true)
      this.storeDispatch.switchFlowNode(node.id)
    }, 150)

    // @ts-ignore
    model.setData({
      ..._.pick(node, passThroughNodeProps),
      isStartNode: this.currentFlow.startNode === node.name,
      isHighlighted: this.highlightedNodeName === node.name
    })

    model.lastModified = node.lastModified
  }

  private _syncNode(node: BpNodeModel, model, snapshot) {
    model.setData({
      ..._.pick(node, passThroughNodeProps),
      isStartNode: this.currentFlow.startNode === node.name,
      isHighlighted: this.highlightedNodeName === node.name
    })

    model.setPosition(node.x, node.y)

    const ports = model.getOutPorts()
    ports.forEach(port => {
      _.values(port.links).forEach(link => {
        this.activeModel.removeLink(link)
        port.removeLink(link)
      })
    })

    // Recreate all the links
    // If there's an existing link saved for target,port .. reuse the point locations

    const allNodes = _.values(this.activeModel.getNodes())
    this._createNodeLinks(model, allNodes, snapshot.links)
    model.lastModified = node.lastModified
  }

  private _createNodeLinks(node, allNodes, existingLinks = []) {
    if (!_.isArray(node.next)) {
      return
    }

    node.next.forEach((next, index) => {
      const target = next.node
      if (/^END$/i.test(target)) {
        // Handle end connection
      } else if (/\.flow/i.test(target)) {
        // Handle subflow connection
      } else {
        const sourcePort = node.ports['out' + index]
        const targetNode = _.find(allNodes, { name: next.node })

        if (!targetNode) {
          // TODO Show warning that target node doesn't exist
          return
        }

        const existingLink = _.find(existingLinks, {
          source: node.id,
          target: targetNode.id,
          sourcePort: sourcePort.name
        })

        const targetPort = targetNode.ports['in']
        const link = new LinkModel()
        link.setSourcePort(sourcePort)
        link.setTargetPort(targetPort)

        if (existingLink) {
          link.setPoints(
            existingLink.points.map(pt => {
              return new PointModel(link, { x: pt.x, y: pt.y })
            })
          )
        }

        this.activeModel.addLink(link)
      }
    })
  }

  private _updateZoomLevel(nodes) {
    const { width: diagramWidth, height: diagramHeight } = this.diagramContainerSize
    const totalFlowWidth = _.max(_.map(nodes, 'x')) - _.min(_.map(nodes, 'x'))
    const totalFlowHeight = _.max(_.map(nodes, 'y')) - _.min(_.map(nodes, 'y'))
    const zoomLevelX = Math.min(1, diagramWidth / (totalFlowWidth + 2 * DIAGRAM_PADDING))
    const zoomLevelY = Math.min(1, diagramHeight / (totalFlowHeight + 2 * DIAGRAM_PADDING))
    const zoomLevel = Math.min(zoomLevelX, zoomLevelY)

    const offsetX = DIAGRAM_PADDING - _.min(_.map(nodes, 'x'))
    const offsetY = DIAGRAM_PADDING - _.min(_.map(nodes, 'y'))

    this.activeModel.setZoomLevel(zoomLevel * 100)
    this.activeModel.setOffsetX(offsetX * zoomLevel)
    this.activeModel.setOffsetY(offsetY * zoomLevel)

    this.diagramWidget && this.diagramWidget.forceUpdate()
  }

  private _serialize = () => {
    const model = this.activeModel.serializeDiagram()
    const nodes = model.nodes.map((node: any) => {
      return {
        ..._.pick(node, 'id', 'name', 'onEnter', 'onReceive'),
        next: node.next.map((next, index) => {
          const port = _.find(node.ports, { name: 'out' + index })

          if (!port || !port.links || !port.links.length) {
            return next
          }

          const link = _.find(model.links, { id: port.links[0] })
          // @ts-ignore
          const otherNodeId = link && (link.source === node.id ? link.target : link.source)
          const otherNode = _.find(model.nodes, { id: otherNodeId })

          if (!otherNode) {
            return next
          }

          return { condition: next.condition, node: otherNode['name'] }
        }),
        position: _.pick(node, 'x', 'y')
      }
    })

    const links = this._serializeLinks()

    return { links, nodes }
  }

  private _serializeLinks() {
    const diagram = this.activeModel.serializeDiagram()

    return diagram.links.map(link => {
      const instance = this.activeModel.getLink(link.id)
      const model = {
        source: link.source,
        sourcePort: instance.getSourcePort().name,
        target: link.target,
        points: link.points.map(pt => ({ x: pt.x, y: pt.y }))
      }

      if (instance.getSourcePort().name === 'in') {
        // We reverse the model so that target is always an input port
        model.source = link.target
        model.sourcePort = instance.getTargetPort().name
        model.target = link.source
        model.points = _.reverse(model.points)
      }

      return model
    })
  }
}

export interface CurrentFlow {
  name: string
  location: string
  catchAll: any
  links: any
  nodes: any
  startNode: string
  version: string
}

interface NodeProblem {
  nodeName: string
  missingPorts: any
}

interface DiagramContainerSize {
  width: number
  height: number
}
type BpNodeModel = StandardNodeModel | SkillCallNodeModel
type ExtendedDiagramModel = {
  linksHash?: number
} & DiagramModel