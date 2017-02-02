/**
 * Created by croberts on 2/2/17.
 */

'use strict';

angular.module('openshiftConsole')
  .controller('OshinkoClustersCtrl',
    function ($scope, $interval, $location, $route,
              DataService, ProjectsService, $routeParams,
              $rootScope, $filter, AlertMessageService, $uibModal) {
      var watches = [];
      var services, pods;
      $scope.projectName = $routeParams.project;
      $scope.serviceName = $routeParams.service;
      $scope.projects = {};
      $scope.oshinkoClusters = {};
      $scope.oshinkoClusterNames = [];
      $scope.alerts = $scope.alerts || {};
      var label = $filter('label');
      $scope.cluster_id = $route.current.params.Id || '';
      $scope.breadcrumbs = [
        {
          title: $scope.projectName,
          link: "project/" + $scope.projectName
        },
        {
          title: "Spark Clusters"
        }
      ];

      AlertMessageService.getAlerts().forEach(function (alert) {
        $scope.alerts[alert.name] = alert.data;
      });
      AlertMessageService.clearAlerts();

      function oshinkoCluster(resource) {
        if (label(resource, "oshinko-cluster")) {
          return true;
        }
        return false;
      }

      function groupByClusters(pods, services) {
        var clusters = {};
        var clusterName;
        var type;
        var podName;
        var svcName;
        var svc;
        _.each(pods, function (pod) {
          if (!oshinkoCluster(pod)) {
            return;
          }
          clusterName = label(pod, "oshinko-cluster");
          podName = _.get(pod, 'metadata.name', '');
          type = label(pod, "oshinko-type");
          //find matching services
          svc = _.find(services, function (service) {
            var svcSelector = new LabelSelector(service.spec.selector);
            return svcSelector.matches(pod);
          });

          if (svc) {
            svcName = _.get(svc, 'metadata.name', '');
            _.set(clusters, [clusterName, type, 'svc', svcName], svc);
          }
          _.set(clusters, [clusterName, type, 'pod', podName], pod);
        });
        //find webui services
        _.each(services, function (service) {
          type = label(service, "oshinko-type");
          if (type === "webui") {
            clusterName = label(service, "oshinko-cluster");
            svcName = _.get(service, 'metadata.name', '');
            _.set(clusters, [clusterName, type, 'svc', svcName], service);
          }
        });

        return clusters;
      }

      var groupClusters = function () {
        if (!pods || !services) {
          return;
        }
        $scope.oshinkoClusters = groupByClusters(pods, services);
        $scope.oshinkoClusterNames = Object.keys($scope.oshinkoClusters);
      };
      $scope.countWorkers = function (cluster) {
        if (!cluster || !cluster.worker || !cluster.worker.pod) {
          return 0;
        }
        var pods = cluster.worker.pod;
        var length = Object.keys(pods).length;
        return length;
      };
      $scope.getClusterName = function (cluster) {
        var name = Object.keys(cluster);
        return name[0];
      };
      $scope.getClusterStatus = function (cluster) {
        var status = "Starting...";
        var podStatus;
        var isPod = false;
        if (!cluster || !cluster.worker || !cluster.worker.pod || !cluster.master || !cluster.master.pod) {
          return "Error";
        }
        //TODO look at more states
        _.each(cluster.worker.pod, function (worker) {
          isPod = true;
          if (worker.status.phase !== "Running") {
            podStatus = worker.status.phase;
            return;
          }
        });

        _.each(cluster.master.pod, function (master) {
          isPod = true;
          if (master.status.phase !== "Running") {
            podStatus = master.status.phase;
            return;
          }
        });
        //return pod status
        if (isPod && podStatus) {
          return podStatus;
        }
        else if (isPod) {
          return "Running";
        }
        //return starting...
        return status;
      };
      $scope.getSparkMasterUrl = function (cluster) {
        var masterUrl = "";
        if (!cluster || !cluster.master || !cluster.master.svc) {
          return "";
        }
        var masterSvc = Object.keys(cluster.master.svc);
        if (masterSvc.length === 0) {
          return "";
        }
        for (var i = 0; i <= masterSvc.length; i++) {
          if (cluster.master.svc[masterSvc[i]].spec.ports[0].port === 7077) {
            masterUrl = "spark://" + masterSvc[i] + ":" + 7077;
            break;
          }
        }
        return masterUrl;
      };
      $scope.getCluster = function () {
        if (!$scope.oshinkoClusters || !$scope.cluster) {
          return;
        }

        var cluster = $scope.oshinkoClusters[$scope.cluster];
        return cluster;
      };

      var project = $routeParams.project;
      ProjectsService
        .get(project)
        .then(_.spread(function (project, context) {
          $scope.project = project;
          $scope.projectContext = context;
          watches.push(DataService.watch("pods", context, function (podsData) {
            $scope.pods = pods = podsData.by("metadata.name");
            groupClusters();
          }));

          watches.push(DataService.watch("services", context, function (serviceData) {
            $scope.services = services = serviceData.by("metadata.name");
            groupClusters();
          }));

          $scope.$on('$destroy', function () {
            DataService.unwatchAll(watches);
          });

        }));

      $scope.$on('$destroy', function () {
        DataService.unwatchAll(watches);
      });

      // Start cluster operations
      $scope.deleteCluster = function deleteCluster(clusterName) {
        var modalInstance = $uibModal.open({
          animation: true,
          controller: 'OshinkoClusterDeleteCtrl',
          templateUrl: 'views/oshinko/' + 'delete-cluster.html',
          backdrop: 'static',
          resolve: {
            dialogData: function () {
              return {clusterName: clusterName};
            }
          }
        });

        modalInstance.result.then(function () {
          var alertName = clusterName + "-delete";
          $scope.alerts[alertName] = {
            type: "success",
            message: clusterName + " has been marked for deletion"
          };
        }).catch(function (reason) {
          if (reason !== "cancel") {
            var alertName = clusterName + "-delete";
            $scope.alerts[alertName] = {
              type: "error",
              message: clusterName + " has been marked for deletion, but there were errors"
            };
          }
        });
      };

      $scope.newCluster = function newCluster() {
        var modalInstance = $uibModal.open({
          animation: true,
          controller: 'OshinkoClusterNewCtrl',
          templateUrl: 'views/oshinko/' + 'new-cluster.html',
          backdrop: 'static',
          resolve: {
            dialogData: function () {
              return {};
            }
          }
        });

        modalInstance.result.then(function (response) {
          var clusterName = response[0].metadata.labels["oshinko-cluster"];
          var alertName = clusterName + "-create";
          $scope.alerts[alertName] = {
            type: "success",
            message: clusterName + " has been created"
          };
        }).catch(function (reason) {
          if (reason !== "cancel") {
            var alertName = "error-create";
            $scope.alerts[alertName] = {
              type: "error",
              message: "Cluster create failed"
            };
          }
        });
      };

      $scope.scaleCluster = function scaleCluster(clusterName, workerCount) {
        var modalInstance = $uibModal.open({
          animation: true,
          controller: 'OshinkoClusterDeleteCtrl',
          templateUrl: 'views/oshinko/' + 'scale-cluster.html',
          backdrop: 'static',
          resolve: {
            dialogData: function () {
              return {
                clusterName: clusterName,
                workerCount: workerCount
              };
            }
          }
        });

        modalInstance.result.then(function (response) {
          var numWorkers = response[0].spec.replicas;
          var alertName = clusterName + "-scale";
          var workers = numWorkers > 1 ? "workers" : "worker";
          $scope.alerts[alertName] = {
            type: "success",
            message: clusterName + " has been scaled to " + numWorkers + " " + workers
          };
        }).catch(function (reason) {
          if (reason !== "cancel") {
            var alertName = "error-scale";
            $scope.alerts[alertName] = {
              type: "error",
              message: "Cluster scale failed"
            };
          }
        });
      };
      // end cluster operations
    }
  );